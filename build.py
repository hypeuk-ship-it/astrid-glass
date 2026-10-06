#!/usr/bin/env python3
"""Inline glass.frag into index.html (between the glass-frag script tags) so it works from file://."""
import re, pathlib
here = pathlib.Path(__file__).parent
frag = (here / 'glass.frag').read_text()
html = (here / 'index.html').read_text()
pat = re.compile(r'(<script type="x-shader/x-fragment" id="glass-frag">)(.*?)(</script>)', re.S)
assert pat.search(html), 'glass-frag tag not found'
assert '</script' not in frag
html = pat.sub(lambda m: m.group(1) + '\n' + frag + m.group(3), html, count=1)
(here / 'index.html').write_text(html)
print(f'inlined glass.frag ({len(frag)} bytes) into index.html')
