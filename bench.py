#!/usr/bin/env python3
"""Headless renderer benchmark (SwiftShader on the box: relative numbers only).
   usage: python3 bench.py [W H] [query]      env PAGE=/path/to/index.html  RUNS=5  N=60
   Prints the median ms/frame of RUNS × N synchronous frames (tick + uniforms + draw + 1-px readback)."""
import json, subprocess, time, urllib.request, websocket, sys, shutil, os, statistics
W,H=sys.argv[1:3] if len(sys.argv)>2 else ('620','680')
qs=sys.argv[3] if len(sys.argv)>3 else '?noadapt&seed=7'
RUNS=int(os.environ.get('RUNS',5)); N=int(os.environ.get('N',60))
p=subprocess.Popen(['google-chrome','--headless=new','--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
  f'--window-size={W},{H}','--remote-debugging-port=9333','--user-data-dir=/tmp/astrid-bench','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
  for _ in range(50):
    try: tabs=json.load(urllib.request.urlopen('http://127.0.0.1:9333/json')); break
    except Exception: time.sleep(.2)
  tab=[t for t in tabs if t['type']=='page'][0]
  ws=websocket.create_connection(tab['webSocketDebuggerUrl'],suppress_origin=True)
  i=[0]; logs=[]
  def cmd(m,**pa):
    i[0]+=1; ws.send(json.dumps({'id':i[0],'method':m,'params':pa}))
    while True:
      r=json.loads(ws.recv())
      if r.get('method') in ('Runtime.consoleAPICalled','Runtime.exceptionThrown','Log.entryAdded'): logs.append(r)
      if r.get('id')==i[0]: return r
  cmd('Runtime.enable'); cmd('Log.enable')
  cmd('Page.navigate',url='file://'+os.environ.get('PAGE','/workspace/astrid-html/index.html')+qs)
  time.sleep(3)
  ev=lambda e: cmd('Runtime.evaluate',expression=e,returnByValue=True)['result']['result'].get('value')
  ev('__astrid.bench(20)')                                   # warm-up
  runs=[ev(f'__astrid.bench({N})') for _ in range(RUNS)]
  print(f'window {W}x{H}  canvas', ev('document.getElementById("gl").width+"x"+document.getElementById("gl").height'),
        ' ms/frame median %.2f  (runs: %s)'%(statistics.median(runs),' '.join('%.2f'%r for r in runs)))
  bad=[l for l in logs if l['method']=='Runtime.exceptionThrown' or (l['method']=='Runtime.consoleAPICalled' and l['params']['type'] in ('error','warning'))]
  print('console errors/warnings:', len(bad))
finally:
  p.kill(); time.sleep(.3); shutil.rmtree('/tmp/astrid-bench',ignore_errors=True)
