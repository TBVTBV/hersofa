/* HERSÖFA standalone platform layer.
   Stands in for the Claude artifact runtime (room, db, user) so the same game
   page runs outside Claude. Phones and the big screen talk through a public
   MQTT broker over secure WebSockets; nobody needs an account.

   Big screen: open index.html from a folder on your computer (file://), or
   add ?host to the URL. Phones: the QR code on the lobby screen. */
(function () {
  var PAGES_URL = 'https://tbvtbv.github.io/hersofa/';
  var BROKERS = [
    { id: 'h', url: 'wss://broker.hivemq.com:8884/mqtt' },
    { id: 'e', url: 'wss://broker.emqx.io:8084/mqtt' }
  ];
  var TOPIC_ROOT = 'hersofa/v1/';
  var HEARTBEAT_MS = 15000;
  var STALE_MS = 50000;

  var params;
  try { params = new URLSearchParams(location.search); } catch (e) { params = { get: function () { return null; }, has: function () { return false; } }; }
  var isHost = location.protocol === 'file:' || params.has('host');
  var brokerOverride = params.get('broker');
  // MQTT 3.1.1 by default: every public broker speaks it. ?mqttv=5 switches to MQTT 5.
  var V5 = params.get('mqttv') === '5';

  function ls(op, k, v) {
    try { if (op === 'get') return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
    return null;
  }
  function rand(n) {
    var a = 'abcdefghijkmnpqrstuvwxyz23456789', out = '';
    var buf = new Uint32Array(n);
    try { crypto.getRandomValues(buf); } catch (e) { for (var i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 1e9); }
    for (var j = 0; j < n; j++) out += a[buf[j] % a.length];
    return out;
  }

  var code, preferred;
  if (isHost) {
    code = ls('get', 'hersofa-code');
    if (!code || !/^[a-z0-9]{6,16}$/.test(code)) { code = rand(10); ls('set', 'hersofa-code', code); }
    preferred = ls('get', 'hersofa-broker');
  } else {
    code = String(params.get('g') || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
    preferred = params.get('b');
  }
  var order = BROKERS.slice();
  if (preferred) order.sort(function (a, b) { return (b.id === preferred) - (a.id === preferred); });
  // A phone must use the same broker as the big screen, so it never falls back to another one.
  if (!isHost) order = [order[0]];
  if (brokerOverride) order = [{ id: 'x', url: brokerOverride }];

  var base = TOPIC_ROOT + code;
  var myPeer = rand(12);
  var myTopic = isHost ? base + '/host' : base + '/p/' + myPeer;
  var subTopic = isHost ? base + '/p/+' : base + '/host';

  var client = null, broker = null, connected = false;
  var mine = Object.freeze({});
  var others = {};
  var peerListeners = [], connListeners = [];
  var snapshot = null, notifyTimer = null, publishTimer = null;

  function buildSnapshot() {
    var list = [Object.freeze({ peer: myPeer, by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: mine, updatedAt: Date.now() })];
    Object.keys(others).forEach(function (k) { list.push(others[k].peer); });
    snapshot = Object.freeze(list);
    return snapshot;
  }
  function notify() {
    if (notifyTimer) return;
    notifyTimer = setTimeout(function () {
      notifyTimer = null;
      var peers = buildSnapshot();
      peerListeners.slice().forEach(function (fn) { try { fn({ peers: peers, joined: [], left: [], updated: [] }); } catch (e) { setTimeout(function () { throw e; }); } });
    }, 16);
  }
  function setConnected(ok) {
    if (connected === ok) return;
    connected = ok;
    connListeners.slice().forEach(function (fn) { try { fn(ok); } catch (e) {} });
  }

  function publishMine() {
    if (!client || !connected) return;
    var body = JSON.stringify({ ts: Date.now(), presence: mine });
    var opts = { qos: 1, retain: true };
    if (V5) opts.properties = { messageExpiryInterval: isHost ? 600 : 120 };
    client.publish(myTopic, body, opts);
  }
  function schedulePublish() {
    if (publishTimer) return;
    publishTimer = setTimeout(function () { publishTimer = null; publishMine(); }, 40);
  }

  function onMessage(topic, payload) {
    var id = isHost ? topic.slice((base + '/p/').length) : 'host';
    if (!id || id === myPeer) return;
    var text = payload ? payload.toString() : '';
    if (!text) { if (others[id]) { delete others[id]; notify(); } return; }
    var msg;
    try { msg = JSON.parse(text); } catch (e) { return; }
    if (!msg || typeof msg !== 'object' || !msg.presence || typeof msg.presence !== 'object') return;
    if (typeof msg.ts === 'number' && msg.ts < Date.now() - 30 * 60 * 1000) return;
    var prev = others[id];
    var same = prev && JSON.stringify(prev.peer.presence) === JSON.stringify(msg.presence);
    if (same) { prev.seen = Date.now(); return; }
    var pres = Object.freeze(msg.presence);
    others[id] = {
      seen: Date.now(),
      peer: Object.freeze({ peer: id, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: pres, updatedAt: Date.now() })
    };
    notify();
  }

  setInterval(function () {
    var now = Date.now(), changed = false;
    Object.keys(others).forEach(function (k) { if (now - others[k].seen > STALE_MS) { delete others[k]; changed = true; } });
    if (changed) notify();
    publishMine();
  }, HEARTBEAT_MS);

  function attach(c) {
    c.on('connect', function () {
      c.subscribe(subTopic, { qos: 1 });
      setConnected(true);
      publishMine();
    });
    c.on('reconnect', function () {});
    c.on('close', function () { setConnected(false); });
    c.on('offline', function () { setConnected(false); });
    c.on('message', onMessage);
  }
  function options() {
    var o = { protocolVersion: V5 ? 5 : 4, clean: true, keepalive: 20, reconnectPeriod: 2000, connectTimeout: 8000, clientId: 'hersofa_' + myPeer };
    if (!isHost) o.will = { topic: myTopic, payload: '', qos: 1, retain: true };
    return o;
  }
  // Big screen: take the first broker that answers. Phones: the broker named in their link.
  function start() {
    return new Promise(function (resolve) {
      if (!window.mqtt) { resolve(false); return; }
      var i = 0;
      function tryNext() {
        if (i >= order.length) {
          broker = order[0];
          client = window.mqtt.connect(broker.url, options());
          attach(client);
          resolve(true);
          return;
        }
        var b = order[i++];
        var c = window.mqtt.connect(b.url, Object.assign(options(), { reconnectPeriod: isHost ? 0 : 2000 }));
        var done = false;
        var timer = setTimeout(function () { if (!done) { done = true; try { c.end(true); } catch (e) {} tryNext(); } }, isHost ? 7000 : 20000);
        c.once('connect', function () {
          if (done) return;
          done = true; clearTimeout(timer);
          broker = b; client = c;
          if (isHost) { ls('set', 'hersofa-broker', b.id); c.options.reconnectPeriod = 2000; }
          attach(c);
          c.subscribe(subTopic, { qos: 1 });
          setConnected(true);
          publishMine();
          resolve(true);
        });
        c.once('error', function () {
          if (done || !isHost) return;
          done = true; clearTimeout(timer);
          try { c.end(true); } catch (e) {}
          tryNext();
        });
      }
      tryNext();
    });
  }

  var roomReady = null;
  var room = Object.freeze({
    presence: function (patch) {
      var next = {};
      Object.keys(mine).forEach(function (k) { next[k] = mine[k]; });
      Object.keys(patch || {}).forEach(function (k) { if (patch[k] === null) delete next[k]; else next[k] = patch[k]; });
      mine = Object.freeze(next);
      schedulePublish();
      notify();
      return Promise.resolve();
    },
    peers: function () { return snapshot || buildSnapshot(); },
    onPeers: function (fn) { peerListeners.push(fn); notify(); return function () { peerListeners = peerListeners.filter(function (f) { return f !== fn; }); }; },
    onConnection: function (fn) { connListeners.push(fn); setTimeout(function () { fn(connected); }, 0); return function () { connListeners = connListeners.filter(function (f) { return f !== fn; }); }; },
    connected: function () { return connected; },
    emit: function () { return Promise.resolve(); },
    on: function () { return function () {}; }
  });

  var db = Object.freeze({
    doc: function (path) {
      var key = 'hersofa-db:' + path;
      return {
        get: function () {
          var raw = ls('get', key);
          return Promise.resolve({ exists: !!raw, data: function () { try { return JSON.parse(raw); } catch (e) { return undefined; } } });
        },
        set: function (d) { ls('set', key, JSON.stringify(d)); return Promise.resolve(); }
      };
    }
  });

  var user = Object.freeze({
    canEdit: function () { return Promise.resolve(isHost); },
    isOwner: function () { return Promise.resolve(isHost); },
    id: function () { return Promise.resolve(myPeer); }
  });

  window.addEventListener('pagehide', function () {
    if (!isHost && client && connected) { try { client.publish(myTopic, '', { qos: 0, retain: true }); } catch (e) {} }
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) publishMine(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') publishMine(); });

  window.HERSOFA_TEXT = {
    noRoom: 'This link is missing the game code. Scan the QR code on the big screen.',
    closed: 'The connection to the game closed. Reload this page to rejoin.'
  };
  window.HERSOFA_LINK = function () {
    if (!broker) return null;
    var pagesBase = location.protocol === 'file:' ? PAGES_URL : location.origin + location.pathname;
    var url = pagesBase + '?g=' + code + '&b=' + broker.id;
    if (brokerOverride) url += '&broker=' + encodeURIComponent(brokerOverride);
    if (params.get('mqttv')) url += '&mqttv=' + encodeURIComponent(params.get('mqttv'));
    return url + '#play';
  };

  window.claude = Object.freeze({
    use: function (name) {
      if (name === 'user') return Promise.resolve(user);
      if (name === 'db') return Promise.resolve(isHost ? db : null);
      if (name === 'room') {
        if (!code) return Promise.resolve(null);
        if (!roomReady) roomReady = start().then(function (ok) { return ok ? room : null; });
        return roomReady;
      }
      return Promise.resolve(null);
    }
  });
})();
