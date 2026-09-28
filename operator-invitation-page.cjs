'use strict';
const { randomBytes } = require('node:crypto');

function invitationPage(ready, noQuery) {
  const nonce = randomBytes(18).toString('base64');
  const script = `
// Remove the fragment and query before reading tokens or doing any network operation.
let fragment = location.hash;
history.replaceState(null, '', location.pathname);
const status = document.getElementById('status');
const form = document.getElementById('invite');
const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : '');
const accepted = ${JSON.stringify(ready && noQuery)};
const configured = ${JSON.stringify(ready)};
// Auth v2.197.0 AccessTokenResponse.AsRedirectURL also appends an empty sb marker.
const fields = ['access_token', 'refresh_token', 'type', 'expires_in', 'expires_at', 'token_type', 'sb'];
const valid = accepted && fragment.startsWith('#') &&
  [...params.keys()].every(key => fields.includes(key) && params.getAll(key).length === 1) &&
  (!params.has('sb') || params.get('sb') === '') &&
  params.get('type') === 'invite' && params.get('token_type') === 'bearer' &&
  !!params.get('access_token') && !!params.get('refresh_token');
let accessToken = valid ? params.get('access_token') : null;
let refreshToken = valid ? params.get('refresh_token') : null;
fragment = '';
for (const key of [...params.keys()]) params.delete(key);
window.addEventListener('pagehide', () => { accessToken = null; refreshToken = null; form.reset(); });
if (valid) {
  form.hidden = false;
  status.textContent = 'Invitación recibida. Elige una contraseña para inicializar tu cuenta. Esto no concede permisos AGY.';
} else {
  status.textContent = !configured ? 'La recepción de invitaciones no está configurada.' :
    !accepted ? 'Código PKCE o parámetros de consulta no admitidos: falta un verificador PKCE iniciado localmente. No se intercambia un código por sí solo. Solicita un enlace de invitación con tokens.' :
    'Enlace de invitación inválido o no compatible. Solo se admite el enlace de invitación con tokens; el código PKCE no está admitido.';
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!valid) return;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const password = form.elements.password.value;
    const confirmation = form.elements.confirmation.value;
    if (password.length < 12 || password.length > 1024 || password !== confirmation) {
      status.textContent = 'La contraseña debe tener entre 12 y 1024 caracteres y coincidir con su confirmación.';
      return;
    }
    const response = await fetch(location.pathname, {
      method: 'POST', mode: 'same-origin', credentials: 'omit',
      headers: { 'Content-Type': 'application/json', 'X-AGY-Operator-Request': '1' },
      body: JSON.stringify({ type: 'invite', accessToken, refreshToken, password, confirmation })
    });
    if (!response.ok) {
      status.textContent = 'No se pudo completar la invitación. El enlace puede estar vencido o no ser válido.';
      return;
    }
    accessToken = null;
    refreshToken = null;
    form.reset();
    form.remove();
    status.textContent = 'Cuenta inicializada. No se han concedido permisos MCP de AGY. Inicia sesión por separado mediante el flujo existente; los permisos requieren una concesión administrativa explícita.';
  } catch {
    status.textContent = 'No se pudo completar la invitación. Inténtalo de nuevo.';
  } finally { button.disabled = false; }
});`;
  return {
    csp: "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'none'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
    html: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Invitación de operador AGY</title></head><body><main><h1>Invitación de operador AGY</h1><p id="status">Comprobando invitación…</p><form id="invite" hidden><label>Contraseña nueva <input name="password" type="password" minlength="12" maxlength="1024" autocomplete="new-password" required></label><label>Confirmar contraseña <input name="confirmation" type="password" minlength="12" maxlength="1024" autocomplete="new-password" required></label><button type="submit">Inicializar cuenta</button></form></main><script nonce="${nonce}">${script}</script></body></html>`,
  };
}
module.exports = { invitationPage };