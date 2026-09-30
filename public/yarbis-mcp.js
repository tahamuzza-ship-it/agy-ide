(function () {
  'use strict';
  const host = document.querySelector('#yarbis-panel .yarbis-body');
  if (!host) return;
  const panel = document.createElement('details');
  panel.style.cssText = 'border:1px solid #78649d;padding:12px;border-radius:8px;margin:12px 0;max-width:100%';
  panel.innerHTML = '<summary>Yarbis Railway · MCP de AGY</summary>' +
    '<p>Solo lectura. No consulta memoria ni crea o envía misiones.</p>' +
    '<button type="button" data-mcp-tool="listar_capacidades_disponibles">Ver capacidades</button> ' +
    '<button type="button" data-mcp-tool="estado_ejecucion">Ver estado de ejecución</button>' +
    '<pre aria-live="polite" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto"></pre>';
  host.appendChild(panel);
  const output = panel.querySelector('pre');
  panel.addEventListener('click', async event => {
    const button = event.target.closest('button[data-mcp-tool]');
    if (!button || !panel.contains(button) || button.disabled) return;
    const tool = button.dataset.mcpTool;
    if (!['listar_capacidades_disponibles', 'estado_ejecucion'].includes(tool)) return;
    button.disabled = true;
    output.textContent = 'Consultando MCP…';
    try {
      const response = await fetch('/api/agy/yarbis-mcp/call', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-agyide-pwd': encodeURIComponent(localStorage.getItem('agyide_auth_v1') || '') },
        body: JSON.stringify({ tool, arguments: {} }),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error(result.error || 'MCP_NO_DISPONIBLE');
      output.textContent = JSON.stringify(result.data, null, 2);
    } catch (error) {
      output.textContent = 'MCP no disponible: ' + (error.message || 'error de conexión');
    } finally { button.disabled = false; }
  });
})();
