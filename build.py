#!/usr/bin/env python3
"""Inline glass.frag into index.html (between the glass-frag script tags) so it works from file://.
   python3 build.py          rewrite index.html
   python3 build.py --check  exit 1 if index.html's inlined shader differs from glass.frag (no write)"""
import re, sys, pathlib
here = pathlib.Path(__file__).parent
frag = (here / 'glass.frag').read_text()
html = (here / 'index.html').read_text()
pat = re.compile(r'(<script type="x-shader/x-fragment" id="glass-frag">)(.*?)(</script>)', re.S)
m = pat.search(html)
assert m, 'glass-frag tag not found'
assert '</script' not in frag
if '--check' in sys.argv:
    ok = m.group(2) == '\n' + frag
    print('index.html shader in sync with glass.frag' if ok else 'OUT OF SYNC: run python3 build.py')
    sys.exit(0 if ok else 1)
html = pat.sub(lambda m: m.group(1) + '\n' + frag + m.group(3), html, count=1)
(here / 'index.html').write_text(html)
print(f'inlined glass.frag ({len(frag)} bytes) into index.html')
