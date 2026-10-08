#!/usr/bin/env python3
"""Inline glass.frag and glass.vert into index.html (their <script> tags) so it works from file://.
   python3 build.py          rewrite index.html
   python3 build.py --check  exit 1 if index.html's inlined shaders differ from the files (no write)"""
import re, sys, pathlib
here = pathlib.Path(__file__).parent
html = (here / 'index.html').read_text()
ok = True
for fname, kind, tid in (('glass.frag', 'x-shader/x-fragment', 'glass-frag'), ('glass.vert', 'x-shader/x-vertex', 'glass-vert')):
    src = (here / fname).read_text()
    assert '</script' not in src
    pat = re.compile(r'(<script type="' + re.escape(kind) + r'" id="' + tid + r'">)(.*?)(</script>)', re.S)
    m = pat.search(html)
    assert m, tid + ' tag not found'
    if '--check' in sys.argv:
        if m.group(2) != '\n' + src: ok = False; print('OUT OF SYNC: ' + fname + ' (run python3 build.py)')
        continue
    html = pat.sub(lambda m: m.group(1) + '\n' + src + m.group(3), html, count=1)
    print(f'inlined {fname} ({len(src)} bytes)')
if '--check' in sys.argv:
    if ok: print('index.html shaders in sync with glass.frag + glass.vert')
    sys.exit(0 if ok else 1)
(here / 'index.html').write_text(html)
