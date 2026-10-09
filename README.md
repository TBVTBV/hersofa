# HERSÖFA: IKEA or War Criminal?

A party quiz for a big screen and phones. A name appears on the screen and
everyone picks IKEA product, war criminal or made up on their phone. Faster
correct answers score more. Nobody needs an account.

## Running the big screen

1. Put the photos in a `photos/` folder next to `index.html`. They are not in
   this repository on purpose.
2. Open `index.html` from that folder in Chrome (double-click it). A file
   opened from your computer always starts as the big screen.
3. Press the right arrow or space to move forward, left arrow to go back.
   Fullscreen and Reset are under Menu, bottom right.

The big screen needs internet. It remembers the game if you reload, and
phones reconnect by themselves.

## Phones

Players scan the QR code on the lobby screen. It opens
`https://tbvtbv.github.io/hersofa/` with the game code in the link, so the
page knows which game to join.

## How it connects

The screen and the phones exchange small messages through a free public
MQTT broker (HiveMQ, with EMQX as a fallback) over secure WebSockets. Only
names, answers and scores travel. Messages go to a random game code, so
other games never mix with yours.

Phones on the same Wi-Fi as the screen work best. Do a test run with one or
two phones before the party.

## Editing

`src/hersofa.html` is the game itself, shared with the Claude artifact
version. `src/standalone.js` replaces Claude's live-room features with the
MQTT connection. After editing either one, run:

```
python3 build.py
```

That rebuilds `index.html`.

## Photo credits

Opener photos come from Wikimedia Commons, Kulturparken Småland and the
IKEA Museum. Each one's credit is on its slide.
