# Vigilante de cuarto para PC1 (Windows): webcam cada 3s, avisa a Telegram con fecha/hora.
import os, time, sys, traceback, urllib.request, urllib.parse
from datetime import datetime

OUT=os.path.join(os.path.expanduser("~"),"vigilancia_pc1")
os.makedirs(OUT, exist_ok=True)
LOG=os.path.join(OUT,"vigilante.log")
def log(*a):
    try:
        with open(LOG,"a",encoding="utf-8") as f:
            f.write(datetime.now().strftime("%H:%M:%S ")+" ".join(str(x) for x in a)+"\n")
    except Exception: pass
log("=== ARRANQUE vigilante PC1 ===")
try:
    import cv2
    log("cv2 OK", cv2.__version__)
except Exception as e:
    log("FATAL import cv2:", e); sys.exit(1)

ENV = r"C:\Users\Roberto1\OneDrive\Desktop\GitHub\cibercode-ide\.env"
def load_env(path):
    d={}
    try:
        for ln in open(path, encoding="utf-8"):
            ln=ln.strip()
            if ln and not ln.startswith("#") and "=" in ln:
                k,v=ln.split("=",1); d[k.strip()]=v.strip().strip('"').strip("'")
    except Exception as e: log("env err",e)
    return d
env=load_env(ENV)
TOKEN=env.get("TELEGRAM_BOT_TOKEN"); CHAT=env.get("TELEGRAM_CHAT_ID")

def ahora(): return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def tg_msg(t):
    if not TOKEN or not CHAT: return
    try:
        data=urllib.parse.urlencode({"chat_id":CHAT,"text":t}).encode()
        urllib.request.urlopen("https://api.telegram.org/bot%s/sendMessage"%TOKEN,data=data,timeout=20)
    except Exception as e: log("msg err",e)

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
    except Exception as e: log("photo err",e)

UMBRAL=18.0; ENFRIA=25; DURACION=3600
log("claves telegram:", "OK" if (TOKEN and CHAT) else "FALTAN")

def abrir_cam():
    for intento in range(5):
        c=cv2.VideoCapture(0, cv2.CAP_DSHOW)
        time.sleep(2)
        if c.isOpened():
            log("camara abierta (intento %d)"%(intento+1)); return c
        c.release(); log("camara no abre, reintento", intento+1); time.sleep(3)
    log("FATAL: camara no abrio tras 5 intentos"); sys.exit(1)

cam=abrir_cam()
tg_msg("PC1: Vigilancia INICIADA - %s. Reporto si hay movimiento por 1 hora."%ahora())
log("aviso de inicio enviado")

fallos=0
def firma():
    global cam, fallos
    ok,fr=cam.read()
    if not ok:
        fallos+=1; log("lectura fallida #%d"%fallos)
        if fallos%3==0:
            log("reconectando camara..."); cam.release(); cam=abrir_cam()
        return None,None
    fallos=0
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
