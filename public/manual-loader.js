(function () {
  if (!document.getElementById('manual-content')) {
    document.body.innerHTML =
      '<main><button id="manual-close" type="button">← Volver a AGY IDE</button>' +
      '<header><h1>📖 Manual Maestro del Ecosistema SGN</h1>' +
      '<p id="manual-status">Cargando la fuente vigente…</p></header>' +
      '<span class="tag">FUENTE ÚNICA · /api/manual</span>' +
      '<section><pre id="manual-content" style="white-space:pre-wrap;overflow-wrap:anywhere">Cargando…</pre></section></main>';
  }
  var closeButton = document.getElementById('manual-close');
  var status = document.getElementById('manual-status');
  var content = document.getElementById('manual-content');

  closeButton.addEventListener('click', function () {
    if (window.opener) {
      window.close();
      return;
    }
    window.location.href = './';
  });

  function password() {
    try {
      return localStorage.getItem('agyide_auth_v1') || '';
    } catch (_) {
      return '';
    }
  }

  fetch('/api/manual', {
    headers: { 'x-agyide-pwd': encodeURIComponent(password()) },
    cache: 'no-store'
  })
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.text();
    })
    .then(function (markdown) {
      content.textContent = markdown;
      status.textContent =
        'Comandos, contratos Railway, PC1/PC2, Buzón/Yarbis, seguridad y procedimientos actualizados.';
    })
    .catch(function () {
      content.className = 'error';
      content.textContent =
        'No se pudo cargar el Manual Maestro. Vuelve a AGY IDE, inicia sesión otra vez y pulsa MANUAL.';
      status.textContent = 'Sesión no disponible.';
    });
})();