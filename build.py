"""Build index.html (the standalone game) from src/hersofa.html.

src/hersofa.html is the same page that runs as the Claude artifact. This script
swaps the artifact runtime for src/standalone.js (public MQTT broker, no login),
points photos at ./photos/ and loads libraries from ./vendor/.

Run: python3 build.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).parent
src = (ROOT / 'src' / 'hersofa.html').read_text(encoding='utf-8')

src = src.replace(
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>',
    '<script src="vendor/qrcode.min.js"></script>')
assert 'vendor/qrcode.min.js' in src

count = 0
def photo(m):
    global count
    count += 1
    return "%s: 'photos/%s.jpg'" % (m.group(1), m.group(1))
src = re.sub(r"(\w+): '/_blob/[0-9a-f]{32}'", photo, src)
assert '/_blob/' not in src, 'unmapped asset reference'

title = re.search(r'<title>.*?</title>\n?', src).group(0)
src = src.replace(title, '')

page = (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
    '<title>HERSÖFA: IKEA or War Criminal?</title>\n'
    '<style>html,body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>\n'
    '<script src="vendor/mqtt.min.js"></script>\n'
    '<script src="src/standalone.js"></script>\n'
    '</head>\n<body>\n' + src + '\n</body>\n</html>\n')
(ROOT / 'index.html').write_text(page, encoding='utf-8')
print('index.html written, %d photos mapped' % count)
