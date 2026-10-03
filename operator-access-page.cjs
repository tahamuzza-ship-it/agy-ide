'use strict';
const { randomBytes } = require('node:crypto');

// Public login page; passwords exist only in this form and the same-origin POST.
// This is not an enrollment API and never grants application permissions.
function accessPage(nextPath) {
  const target = typeof nextPath === 'string'
    && /^\/api\/agy\/link\/approve\/[A-Za-z0-9_-]{43}$/.test(nextPath)
    ? nextPath : '';
  const nonce = randomBytes(24).toString('base64');
  const html = `<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acceso individual AGY</title>
<style nonce="${nonce}">body{font:16px system-ui,sans-serif;background:#f3f6fa;color:#17324d;margin:0;padding:32px 18px}
main{max-width:480px;margin:24px auto;background:white;padding:28px;border-radius:12px}
h1{font-size:24px;margin-top:0}label{display:block;margin:18px 0 6px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:12px;border:1px solid #94a3b8;border-radius:6px}
button{margin-top:22px;background:#17324d;color:white;cursor:pointer}button:disabled{opacity:.6}p{line-height:1.5}#status{min-height:48px}</style>
</head><body><main><h1>Acceso individual AGY</h1>
<p>Use su cuenta ya autorizada. Esta página no crea permisos ni activa otras aplicaciones.</p>
<form id="access">
<label for="legacy">Clave de acceso a AGY-IDE</label>
<input id="legacy" type="password" maxlength="1024" required autocomplete="off">
<label for="email">Correo de su cuenta</label>
<input id="email" type="email" maxlength="254" required autocomplete="username">
<label for="password">Contraseña de su cuenta</label>
<input id="password" type="password" maxlength="1024" required autocomplete="current-password">
<button id="submit" type="submit">Iniciar sesión</button></form>
<p id="status" role="status" aria-live="polite"></p>
<p>La vinculación de Yarbis se aprueba después, por separado. No comparta estas claves en el chat.</p>
</main><script nonce="${nonce}">
'use strict';
const form=document.getElementById('access'), status=document.getElementById('status');
const nextPath=${JSON.stringify(target)};
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=document.getElementById('submit');
  if(button.disabled)return;
  button.disabled=true;status.textContent='Comprobando su acceso…';
  const legacy=document.getElementById('legacy');
  const email=document.getElementById('email');
  const password=document.getElementById('password');
  try{
    const response=await fetch('/api/agy/operator/login',{
      method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
      headers:{'Content-Type':'application/json','x-agy-operator-request':'1','x-agyide-pwd':legacy.value},
      body:JSON.stringify({email:email.value.trim(),password:password.value}),
      signal:AbortSignal.timeout(15000)
    });
    const data=await response.json();
    if(!response.ok||data.ok!==true)throw Error('LOGIN_RECHAZADO');
    legacy.value='';password.value='';email.value='';
    if(nextPath)location.replace(nextPath);
    else{form.hidden=true;status.textContent='Sesión iniciada. Vuelva a Yarbis y solicite el acceso propio a AGY.';}
  }catch{status.textContent='No se confirmó el acceso. Revise las credenciales y que el servidor esté habilitado.';}
  finally{password.value='';legacy.value='';button.disabled=false;}
});
addEventListener('pagehide',()=>{for(const id of ['legacy','email','password'])document.getElementById(id).value='';});
</script></body></html>`;
  return { html, headers: {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  }};
}
module.exports = { accessPage };