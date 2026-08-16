# Vigilante de cuarto para PC1 (Windows): webcam cada 3s, avisa a Telegram con fecha/hora.
import os, time, urllib.request, urllib.parse
from datetime import datetime
import cv2

ENV = r"C:\Users\Roberto1\OneDrive\Desktop\GitHub\cibercode-ide\.env"
def load_env(path):
    d={}
    try:
        for ln in open(path, encoding="utf-8"):
            ln=ln.strip()
            if ln and not ln.startswith("#") and "=" in ln:
                k,v=ln.split("=",1); d[k.strip()]=v.strip().strip('"').strip("'")
    except Exception as e: print("env err",e)
    return d
env=load_env(ENV)
TOKEN=env.get("TELEGRAM_BOT_TOKEN"); CHAT=env.get("TELEGRAM_CHAT_ID")

OUT=os.path.join(os.path.expanduser("~"),"vigilancia_pc1")
os.makedirs(OUT, exist_ok=True)
def ahora(): return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def tg_msg(t):
    if not TOKEN or not CHAT: return
    try:
        data=urllib.parse.urlencode({"chat_id":CHAT,"text":t}).encode()
        urllib.request.urlopen("https://api.telegram.org/bot%s/sendMessage"%TOKEN,data=data,timeout=20)
    except Exception as e: print("msg err",e)

def tg_photo(path,cap):
    if not TOKEN or not CHAT: return
    try:
        bnd="----vig%d"%int(time.time())
        img=open(path,"rb").read(); body=b""
        for k,v in (("chat_id",CHAT),("caption",cap)):
            body+=("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n"%(bnd,k,v)).encode()
        body+=("--%s\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"f.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n"%bnd).encode()
        body+=img+("\r\n--%s--\r\n"%bnd).encode()
        req=urllib.request.Request("https://api.telegram.org/bot%s/sendPhoto"%TOKEN,data=body)
        req.add_header("Content-Type","multipart/form-data; boundary=%s"%bnd)
        urllib.request.urlopen(req,timeout=30)
    except Exception as e: print("photo err",e)

UMBRAL=18.0; ENFRIA=25; DURACION=3600
cam=cv2.VideoCapture(0, cv2.CAP_DSHOW)
time.sleep(2)
tg_msg("PC1: Vigilancia INICIADA - %s. Reporto si hay movimiento por 1 hora."%ahora())

def firma():
    ok,fr=cam.read()
    if not ok: return None,None
    g=cv2.cvtColor(cv2.resize(fr,(64,48)),cv2.COLOR_BGR2GRAY)
    return g,fr
def dif(a,b):
    if a is None or b is None: return 0
    return float(cv2.absdiff(a,b).mean())

base,_=firma()
fin=time.time()+DURACION; ultimo=0; alertas=0
while time.time()<fin:
    time.sleep(3)
    g,fr=firma()
    if g is None: continue
    d=dif(base,g)
    if base is not None and d>=UMBRAL and (time.time()-ultimo)>ENFRIA:
        ts=ahora(); nombre=os.path.join(OUT,"intruso_%s.jpg"%datetime.now().strftime("%Y%m%d_%H%M%S"))
        cv2.imwrite(nombre,fr); alertas+=1
        tg_photo(nombre,"PC1 - MOVIMIENTO detectado\nFecha: %s\n(alerta #%d)"%(ts,alertas))
        print("ALERTA",ts,"d=%.1f"%d); ultimo=time.time()
    base=g
cam.release()
tg_msg("PC1: Vigilancia FINALIZADA - %s. Alertas: %d."%(ahora(),alertas))
print("FIN",alertas)
