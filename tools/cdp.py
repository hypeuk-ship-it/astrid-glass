"""Minimal headless-Chrome CDP page driver for the Astrid QA tools (rebuilt 7 Oct 2026; was /tmp/cdp.py).
   p = Page(w, h); p.go(url, wait); p.ev(js) -> value; p.shot(path); p.errors(); p.close()"""
import json, os, subprocess, time, base64, socket, shutil, tempfile, urllib.request
import websocket

def _free_port():
  s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

class Page:
  def __init__(self, w=620, h=680):
    self.w, self.h = w, h; self.port = _free_port(); self.udd = tempfile.mkdtemp(prefix='cdp-chrome-')
    self.proc = subprocess.Popen(['google-chrome', '--headless=new', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--disable-gpu-vsync',
      f'--window-size={w},{h}', f'--remote-debugging-port={self.port}', f'--user-data-dir={self.udd}', 'about:blank'],
      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    tgt = None
    for _ in range(100):
      try:
        tgt = next(t for t in json.load(urllib.request.urlopen(f'http://127.0.0.1:{self.port}/json', timeout=1)) if t.get('type') == 'page'); break
      except Exception: time.sleep(.1)
    self.ws = websocket.create_connection(tgt['webSocketDebuggerUrl'], suppress_origin=True, timeout=120)
    self.i = 0; self._errs = []
    for m in ('Runtime.enable', 'Log.enable', 'Page.enable'): self.send(m)
    self.send('Emulation.setDeviceMetricsOverride', dict(width=w, height=h, deviceScaleFactor=1, mobile=False))
  def _event(self, r):
    m = r.get('method'); p = r.get('params', {})
    if m == 'Runtime.exceptionThrown':
      d = p['exceptionDetails']; self._errs.append('EXC ' + (d.get('exception', {}).get('description') or d.get('text', '')))
    elif m == 'Runtime.consoleAPICalled' and p.get('type') in ('error', 'warning', 'assert'):
      self._errs.append(p['type'] + ' ' + ' '.join(str(a.get('value', a.get('description', ''))) for a in p.get('args', [])))
    elif m == 'Log.entryAdded' and p['entry'].get('level') in ('error',):
      self._errs.append('log ' + p['entry'].get('text', ''))
  def send(self, method, params=None):
    self.i += 1; i = self.i
    self.ws.send(json.dumps(dict(id=i, method=method, params=params or {})))
    while True:
      r = json.loads(self.ws.recv())
      if r.get('id') == i:
        if 'error' in r: raise RuntimeError(f'{method}: {r["error"]}')
        return r.get('result', {})
      self._event(r)
  def go(self, url, wait=.5):
    self.send('Page.navigate', dict(url=url))
    for _ in range(200):
      if self.ev('document.readyState') == 'complete': break
      time.sleep(.05)
    time.sleep(wait)
  def ev(self, js):
    r = self.send('Runtime.evaluate', dict(expression=js, returnByValue=True, awaitPromise=True))
    if 'exceptionDetails' in r:
      d = r['exceptionDetails']; raise RuntimeError('JS: ' + (d.get('exception', {}).get('description') or d.get('text', '')))
    return r.get('result', {}).get('value')
  def shot(self, path):
    r = self.send('Page.captureScreenshot', dict(format='png', captureBeyondViewport=False))
    open(path, 'wb').write(base64.b64decode(r['data']))
  def errors(self): return list(self._errs)
  def close(self):
    try: self.ws.close()
    except Exception: pass
    self.proc.terminate()
    try: self.proc.wait(5)
    except Exception: self.proc.kill()
    shutil.rmtree(self.udd, ignore_errors=True)
