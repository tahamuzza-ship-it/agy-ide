/**
 * 🏛️ CONSTITUCIÓN SGN, SDD VIVO Y CONSOLA DE PRUEBAS DIDÁCTICAS HTML
 * AGY-IDE (CiberCode 2.0) | Ecosistema Multi-Nodo SGN
 */
(function() {
  'use strict';

  // Referencias DOM
  const modalConst = document.getElementById('constitucion-modal');
  const modalPruebas = document.getElementById('pruebas-didacticas-modal');
  const constBody = document.getElementById('constitucion-body');
  const constSearch = document.getElementById('constitucion-search');
  const btnConst = document.getElementById('btn-constitucion');
  const btnSdd = document.getElementById('btn-sdd-matrix');
  const btnPruebas = document.getElementById('btn-pruebas-html');
  const btnSalud = document.getElementById('btn-salud-flota');
  const btnConstClose = document.getElementById('constitucion-close');
  const btnPruebasClose = document.getElementById('pruebas-close');
  const btnConstRefresh = document.getElementById('constitucion-refresh');
  const btnRunAll = document.getElementById('btn-ejecutar-todas-pruebas');
  const btnCopyResult = document.getElementById('btn-copiar-resultado-prueba');

  // Visor de resultados de pruebas
  const elHttpBadge = document.getElementById('metrica-http-status');
  const elLatencia = document.getElementById('metrica-latencia');
  const elTipo = document.getElementById('metrica-tipo');
  const elBadgeRes = document.getElementById('prueba-badge-resultado');
  const elTiempoMs = document.getElementById('prueba-tiempo-ms');
  const elJsonOut = document.getElementById('prueba-json-output');
  const elSubtitulo = document.getElementById('prueba-resultado-subtitulo');

  // Estado interno
  let constitucionData = null;
  let sddData = null;
  let activeTab = 'doctrina';
  let ultimoResultadoJson = '';

  // Helpers de autenticación (usa la contraseña almacenada en localStorage/session)
  function getIdePwd() {
    return localStorage.getItem('agyide_pwd') || sessionStorage.getItem('agyide_pwd') || '';
  }

  /* ══════════════════════════════════════════
     1. GOBERNANZA Y CONSTITUCIÓN SGN
  ══════════════════════════════════════════ */
  async function cargarConstitucion(forzar = false) {
    if (constitucionData && !forzar) return constitucionData;
    try {
      const res = await fetch('/api/constitucion');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      constitucionData = await res.json();
      return constitucionData;
    } catch (err) {
      console.error('[Constitución] Error cargando datos:', err);
      return null;
    }
  }

  async function cargarSdd(forzar = false) {
    if (sddData && !forzar) return sddData;
    try {
      const res = await fetch('/api/sdd/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sddData = await res.json();
      return sddData;
    } catch (err) {
      console.error('[SDD] Error cargando status:', err);
      return null;
    }
  }

  function renderizarTab(tabName) {
    activeTab = tabName;
    if (!constBody) return;

    // Actualizar botones de pestaña
    document.querySelectorAll('.const-tab-btn').forEach(btn => {
      const isAct = btn.getAttribute('data-tab') === tabName;
      btn.classList.toggle('active', isAct);
      btn.style.background = isAct ? 'rgba(124,58,237,0.35)' : 'rgba(255,255,255,0.04)';
      btn.style.borderColor = isAct ? '#8b5cf6' : 'rgba(167,139,250,0.25)';
      btn.style.color = isAct ? '#ede9fe' : '#a78bfa';
    });

    const data = constitucionData || {};
    let html = '';

    if (tabName === 'doctrina') {
      const s = data.santo_y_sena || {};
      html = `
        <div style="display:flex;flex-direction:column;gap:16px;">
          <div style="background:linear-gradient(135deg,rgba(109,40,217,0.2),rgba(30,27,75,0.4));border:1px solid #8b5cf6;border-radius:12px;padding:16px;">
            <div style="font-family:'Orbitron',monospace;font-size:0.75rem;color:#c4b5fd;letter-spacing:0.08em;margin-bottom:6px;">⚡ SANTO Y SEÑA CANÓNICO</div>
            <div style="font-size:0.85rem;color:#94a3b8;font-style:italic;margin-bottom:4px;">"${escapeHtml(s.desafio || 'La tormenta le susurra al guerrero...')}"</div>
            <div style="font-size:1.15rem;font-weight:900;color:#f3b7ff;font-family:'Orbitron',monospace;letter-spacing:0.06em;">${escapeHtml(s.respuesta || '¡YO SOY LA TORMENTA!')}</div>
            <div style="font-size:0.75rem;color:#38bdf8;margin-top:8px;border-top:1px dashed rgba(139,92,246,0.3);padding-top:8px;">
              <strong>Doctrina Operativa:</strong> "${escapeHtml(s.doctrina || 'El que habla por micrófono no aprieta tuercas; y el que aprieta tuercas no gasta saliva.')}"
            </div>
          </div>

          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(167,139,250,0.2);border-radius:12px;padding:16px;">
            <div style="font-family:'Orbitron',monospace;font-size:0.75rem;color:#34d399;letter-spacing:0.08em;margin-bottom:6px;">🛡️ REGLA CERO CARROS LOCOS</div>
            <p style="margin:0;color:#e2e8f0;line-height:1.5;">${escapeHtml(data.regla_cero || 'Lo que se construye hoy debe funcionar hoy, mañana y siempre.')}</p>
          </div>

          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(167,139,250,0.2);border-radius:12px;padding:16px;">
            <div style="font-family:'Orbitron',monospace;font-size:0.75rem;color:#60a5fa;letter-spacing:0.08em;margin-bottom:8px;">🎯 DOCTRINA DE LOS 4 PUNTOS SAGRADOS</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:8px;">
              ${(data.cuatro_puntos_sagrados || [
                '1. ¿QUÉ se va a hacer?',
                '2. ¿POR QUÉ se debe hacer?',
                '3. ¿PARA QUÉ sirve?',
                '4. ¿CÓMO se va a ejecutar exactamente?'
              ]).map(p => `
                <div style="background:rgba(15,23,42,0.6);border:1px solid rgba(96,165,250,0.25);border-radius:8px;padding:10px;font-weight:700;color:#93c5fd;">
                  ${escapeHtml(p)}
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    } else if (tabName === 'flota') {
      const f = data.flota || {};
      html = `
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div style="font-family:'Orbitron',monospace;font-size:0.75rem;color:#c4b5fd;letter-spacing:0.06em;margin-bottom:4px;">🌐 NODOS FEDERADOS Y ROLES CONSTITUCIONALES</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:12px;">
            ${Object.keys(f).map(k => {
              const node = f[k];
              return `
                <div style="background:rgba(15,23,42,0.7);border:1px solid rgba(167,139,250,0.25);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:6px;">
                  <div style="display:flex;align-items:center;justify-content:space-between;">
                    <span style="font-family:'Orbitron',monospace;font-weight:800;color:#ede9fe;font-size:0.85rem;">${k}</span>
                    <span style="font-size:0.65rem;background:#312e81;color:#c7d2fe;padding:2px 8px;border-radius:6px;font-weight:700;">${escapeHtml(node.os || 'SOBERANO')}</span>
                  </div>
                  <div style="font-size:0.8rem;font-weight:700;color:#a78bfa;">${escapeHtml(node.nombre || k)}</div>
                  <div style="font-size:0.72rem;color:#cbd5e1;line-height:1.4;">${escapeHtml(node.rol || node.servicio || '')}</div>
                  ${node.ip ? `<div style="font-size:0.68rem;color:#38bdf8;">📍 IP / LAN: ${escapeHtml(node.ip)}</div>` : ''}
                  ${node.cuenta ? `<div style="font-size:0.68rem;color:#94a3b8;">📧 Cuenta: ${escapeHtml(node.cuenta)}</div>` : ''}
                  ${node.url ? `<div style="font-size:0.68rem;color:#34d399;">🔗 URL: <a href="${escapeHtml(node.url)}" target="_blank" style="color:#6ee7b7;">${escapeHtml(node.url)}</a></div>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    } else if (tabName === 'regla7') {
      html = `
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div style="background:linear-gradient(135deg,rgba(153,27,27,0.3),rgba(69,10,10,0.5));border:1px solid #ef4444;border-radius:12px;padding:18px;">
            <div style="font-family:'Orbitron',monospace;font-size:0.85rem;color:#fca5a5;font-weight:900;letter-spacing:0.08em;margin-bottom:8px;">🛑 REGLA 7: BLINDAJE SAGRADO DE PRODUCCIÓN</div>
            <p style="font-size:0.88rem;color:#fee2e2;font-weight:700;margin:0 0 10px;line-height:1.5;">${escapeHtml(data.regla_7 || 'Producción es sagrada e intocable en caliente.')}</p>
            <div style="background:rgba(0,0,0,0.4);border-left:4px solid #ef4444;padding:10px 14px;border-radius:4px;font-family:'Courier New',monospace;font-size:0.8rem;color:#fca5a5;">
              AUTORIZACIÓN REQUERIDA:<br>
              <strong>"AUTORIZO TOCAR AGY-IDE"</strong>
            </div>
          </div>

          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(167,139,250,0.2);border-radius:12px;padding:16px;">
            <div style="font-family:'Orbitron',monospace;font-size:0.75rem;color:#c4b5fd;letter-spacing:0.06em;margin-bottom:6px;">🔒 RAMA MAIN SELLADA</div>
            <ul style="margin:0;padding-left:20px;color:#cbd5e1;line-height:1.6;font-size:0.78rem;">
              <li>Prohibido realizar commits o pushes directos a <code>main</code> sobre servidores vivos.</li>
              <li>Todo trabajo debe realizarse en un taller aislado en rama <code>feature/...</code>.</li>
              <li>Validación E2E previa con pruebas unitarias automáticas pasando en verde (<code>exit_code: 0</code>).</li>
              <li>Revisión de Diff y aprobación humana antes de fusionar.</li>
            </ul>
          </div>
        </div>
      `;
    } else if (tabName === 'sdd') {
      const sdd = sddData || {};
      html = `
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div style="background:linear-gradient(135deg,rgba(5,150,105,0.2),rgba(6,78,59,0.4));border:1px solid #10b981;border-radius:12px;padding:16px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <span style="font-family:'Orbitron',monospace;font-size:0.82rem;color:#6ee7b7;font-weight:900;">📐 ESPECIFICACIÓN SDD VIVA (SPEC-DRIVEN DEVELOPMENT)</span>
              <span style="background:#064e3b;color:#a7f3d0;font-size:0.65rem;padding:2px 8px;border-radius:6px;font-weight:700;">v${escapeHtml(sdd.sdd_version || '1.0.0')} · ${escapeHtml(sdd.estado || 'SINCRONIZADO')}</span>
            </div>
            <div style="font-size:0.78rem;color:#d1fae5;line-height:1.5;">
              <strong>Principio de Doble Fuente de Verdad:</strong> La especificación y el código fuente constituyen una verdad simultánea e inmutable. Si cambia el código, cambia la especificación; si cambia la especificación, el código refleja el cambio.
            </div>
            <div style="font-size:0.72rem;color:#a7f3d0;margin-top:8px;border-top:1px dashed rgba(16,185,129,0.3);padding-top:8px;">
              <strong>Criterio de Cierre (Definition of Done):</strong> ${escapeHtml(sdd.definicion_de_hecho || '100% de alineación entre código y spec, tests en verde exit_code: 0')}
            </div>
          </div>

          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(52,211,153,0.25);border-radius:12px;padding:16px;">
            <div style="font-family:'Orbitron',monospace;font-size:0.75rem;color:#6ee7b7;letter-spacing:0.06em;margin-bottom:10px;">📋 MÓDULOS VERIFICADOS EN EL SISTEMA</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${(sdd.modulos || [
                { modulo: 'Gobernanza Constitucional', spec: 'docs/CONSTITUCION_SGN.md', status: 'VERIFICADO' },
                { modulo: 'Matriz SDD Viva', spec: 'docs/SPEC_SDD_VIVA.md', status: 'VERIFICADO' },
                { modulo: 'Consola Multi-Nodo (PC1, PC2, PC3, PC4)', spec: 'server.js /api/pc-command', status: 'VERIFICADO' },
                { modulo: 'SafeTarget Guardrail', spec: 'test/pc4-terminal.test.cjs', status: 'VERIFICADO' },
                { modulo: 'Header 3 Filas Balanceadas', spec: 'test/header-rows.test.cjs', status: 'VERIFICADO' }
              ]).map(m => `
                <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(6,20,38,0.7);border:1px solid rgba(52,211,153,0.2);border-radius:8px;padding:10px 14px;">
                  <div>
                    <div style="font-size:0.78rem;font-weight:700;color:#e2e8f0;">${escapeHtml(m.modulo)}</div>
                    <div style="font-size:0.65rem;color:#94a3b8;font-family:'Courier New',monospace;">${escapeHtml(m.spec)}</div>
                  </div>
                  <span style="font-size:0.65rem;background:#065f46;color:#a7f3d0;padding:3px 8px;border-radius:6px;font-weight:800;">🟢 ${escapeHtml(m.status)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    } else if (tabName === 'markdown') {
      const md = data.markdown || 'Sin contenido Markdown disponible.';
      html = `
        <div style="background:#020612;border:1px solid rgba(167,139,250,0.25);border-radius:10px;padding:16px;">
          <pre style="margin:0;font-family:'Courier New',monospace;font-size:0.74rem;color:#c4b5fd;white-space:pre-wrap;word-break:break-word;line-height:1.5;">${escapeHtml(md)}</pre>
        </div>
      `;
    }

    constBody.innerHTML = html;
  }

  function filtrarContenido(q) {
    if (!constBody) return;
    const term = (q || '').trim().toLowerCase();
    if (!term) {
      renderizarTab(activeTab);
      return;
    }
    const elements = constBody.querySelectorAll('div, p, li');
    elements.forEach(el => {
      if (el.children.length === 0) {
        const text = el.textContent.toLowerCase();
        el.style.display = text.includes(term) ? '' : 'none';
      }
    });
  }

  async function abrirConstitucion(tab = 'doctrina') {
    if (!modalConst) return;
    modalConst.style.display = 'flex';
    await cargarConstitucion();
    if (tab === 'sdd') await cargarSdd();
    renderizarTab(tab);
  }

  function cerrarConstitucion() {
    if (modalConst) modalConst.style.display = 'none';
  }

  /* ══════════════════════════════════════════
     2. CONSOLA DIDÁCTICA DE PRUEBAS HTML
  ══════════════════════════════════════════ */
  function abrirPruebas() {
    if (modalPruebas) modalPruebas.style.display = 'flex';
  }

  function cerrarPruebas() {
    if (modalPruebas) modalPruebas.style.display = 'none';
  }

  async function ejecutarPruebaDidactica(tipo) {
    const statusPill = document.getElementById(`status-${tipo}`);
    if (statusPill) {
      statusPill.textContent = '🟡 EJECUTANDO…';
      statusPill.style.background = '#854d0e';
      statusPill.style.color = '#fef08a';
    }

    if (elBadgeRes) {
      elBadgeRes.textContent = '🟡 PROCESANDO…';
      elBadgeRes.style.background = 'rgba(234,179,8,0.2)';
      elBadgeRes.style.color = '#fde047';
    }

    const t0 = performance.now();
    let res = null;
    let data = null;
    let httpStatus = 0;
    let errorMsg = null;

    try {
      const pwd = getIdePwd();
      const headers = { 'Content-Type': 'application/json' };
      if (pwd) headers['x-agyide-pwd'] = pwd;

      if (tipo === 'heartbeat') {
        res = await fetch('/api/heartbeat', { headers });
        httpStatus = res.status;
        data = await res.json();
      } else if (tipo === 'pc1') {
        res = await fetch('/api/pc-command', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: '/pc1 hostname' })
        });
        httpStatus = res.status;
        data = await res.json();
      } else if (tipo === 'pc2') {
        res = await fetch('/api/pc-command', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: '/pc2 hostname' })
        });
        httpStatus = res.status;
        data = await res.json();
      } else if (tipo === 'pc3') {
        res = await fetch('/api/morning/status', { headers });
        httpStatus = res.status;
        data = await res.json();
      } else if (tipo === 'pc4') {
        res = await fetch('/api/pc-command', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: '/pc4 hostname' })
        });
        httpStatus = res.status;
        data = await res.json();
      } else if (tipo === 'safetarget') {
        // Intencionadamente un target prohibido para validar el rechazo de guardrail
        res = await fetch('/api/pc-command', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: '/pc999 hostname' })
        });
        httpStatus = res.status;
        data = await res.json();
      } else if (tipo === 'sdd') {
        res = await fetch('/api/sdd/status', { headers });
        httpStatus = res.status;
        data = await res.json();
      } else {
        throw new Error(`Tipo de prueba desconocido: ${tipo}`);
      }
    } catch (err) {
      errorMsg = err.message;
      data = { error: err.message };
    }

    const elapsed = Math.round(performance.now() - t0);

    // Evaluar éxito
    // Caso especial safetarget: HTTP 400 es el resultado CORRECTO y esperado
    const esExito = tipo === 'safetarget' 
      ? (httpStatus === 400) 
      : (httpStatus >= 200 && httpStatus < 300);

    // Actualizar píldora de la prueba individual
    if (statusPill) {
      if (tipo === 'safetarget' && esExito) {
        statusPill.textContent = '🟢 GUARDRAIL ACTIVO (400)';
        statusPill.style.background = '#065f46';
        statusPill.style.color = '#a7f3d0';
      } else if (esExito) {
        statusPill.textContent = `🟢 APROBADA (${httpStatus})`;
        statusPill.style.background = '#065f46';
        statusPill.style.color = '#a7f3d0';
      } else {
        statusPill.textContent = `🔴 FALLÓ (${httpStatus || 'ERR'})`;
        statusPill.style.background = '#991b1b';
        statusPill.style.color = '#fecaca';
      }
    }

    // Actualizar panel lateral de resultado
    if (elHttpBadge) elHttpBadge.textContent = httpStatus || 'ERR';
    if (elLatencia) elLatencia.textContent = `${elapsed} ms`;
    if (elTipo) elTipo.textContent = tipo.toUpperCase();
    if (elTiempoMs) elTiempoMs.textContent = `⏱️ ${elapsed} ms`;

    if (elBadgeRes) {
      if (esExito) {
        elBadgeRes.textContent = tipo === 'safetarget' ? '🟢 GUARDRAIL FUNCIONANDO' : '🟢 PRUEBA EXITOSA';
        elBadgeRes.style.background = 'rgba(16,185,129,0.2)';
        elBadgeRes.style.color = '#6ee7b7';
      } else {
        elBadgeRes.textContent = '🔴 PRUEBA CON INCIDENCIA';
        elBadgeRes.style.background = 'rgba(239,68,68,0.2)';
        elBadgeRes.style.color = '#fca5a5';
      }
    }

    if (elSubtitulo) {
      elSubtitulo.textContent = `Resultado en vivo para prueba: ${tipo.toUpperCase()} (${elapsed} ms)`;
    }

    ultimoResultadoJson = JSON.stringify(data, null, 2);
    if (elJsonOut) {
      elJsonOut.textContent = ultimoResultadoJson;
    }

    return { tipo, esExito, elapsed, httpStatus };
  }

  // Ejecución en batería de todas las pruebas
  async function probarTodoEnBateria() {
    const tipos = ['heartbeat', 'pc1', 'pc2', 'pc3', 'pc4', 'safetarget', 'sdd'];
    if (btnRunAll) {
      btnRunAll.disabled = true;
      btnRunAll.textContent = '⏳ EJECUTANDO BATERÍA…';
    }

    const resultados = [];
    for (const tipo of tipos) {
      const res = await ejecutarPruebaDidactica(tipo);
      resultados.push(res);
      await new Promise(r => setTimeout(r, 250)); // Breve pausa didáctica
    }

    if (btnRunAll) {
      btnRunAll.disabled = false;
      btnRunAll.textContent = '⚡ PROBAR TODO EN BATERÍA';
    }

    const aprobadas = resultados.filter(r => r.esExito).length;
    if (elSubtitulo) {
      elSubtitulo.textContent = `Batería completada: ${aprobadas} de ${tipos.length} pruebas validadas correctamente.`;
    }
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return String(str || '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /* ══════════════════════════════════════════
     3. ASIGNACIÓN DE EVENTOS
  ══════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', function() {
    // Botones de Fila 3
    if (btnConst) btnConst.addEventListener('click', () => abrirConstitucion('doctrina'));
    if (btnSdd) btnSdd.addEventListener('click', () => abrirConstitucion('sdd'));
    if (btnPruebas) btnPruebas.addEventListener('click', abrirPruebas);
    if (btnSalud) {
      btnSalud.addEventListener('click', () => {
        abrirPruebas();
        ejecutarPruebaDidactica('heartbeat');
      });
    }

    // Cierre de modales
    if (btnConstClose) btnConstClose.addEventListener('click', cerrarConstitucion);
    if (btnPruebasClose) btnPruebasClose.addEventListener('click', cerrarPruebas);
    if (btnConstRefresh) {
      btnConstRefresh.addEventListener('click', async () => {
        btnConstRefresh.textContent = '⏳ Sincronizando…';
        await cargarConstitucion(true);
        await cargarSdd(true);
        renderizarTab(activeTab);
        btnConstRefresh.textContent = '🔄 Sincronizar';
      });
    }

    // Pestañas del modal de Constitución
    document.querySelectorAll('.const-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        renderizarTab(tab);
      });
    });

    // Filtro de búsqueda
    if (constSearch) {
      constSearch.addEventListener('input', e => {
        filtrarContenido(e.target.value);
      });
    }

    // Botones de la consola de pruebas
    const testButtons = [
      { id: 'btn-run-heartbeat', tipo: 'heartbeat' },
      { id: 'btn-run-pc1', tipo: 'pc1' },
      { id: 'btn-run-pc2', tipo: 'pc2' },
      { id: 'btn-run-pc3', tipo: 'pc3' },
      { id: 'btn-run-pc4', tipo: 'pc4' },
      { id: 'btn-run-safetarget', tipo: 'safetarget' },
      { id: 'btn-run-sdd', tipo: 'sdd' }
    ];

    testButtons.forEach(tb => {
      const el = document.getElementById(tb.id);
      if (el) el.addEventListener('click', () => ejecutarPruebaDidactica(tb.tipo));
    });

    if (btnRunAll) btnRunAll.addEventListener('click', probarTodoEnBateria);

    if (btnCopyResult) {
      btnCopyResult.addEventListener('click', () => {
        if (!ultimoResultadoJson) return;
        navigator.clipboard.writeText(ultimoResultadoJson).then(() => {
          const original = btnCopyResult.textContent;
          btnCopyResult.textContent = '✅ ¡Copiado!';
          setTimeout(() => { btnCopyResult.textContent = original; }, 1500);
        });
      });
    }

    // Cierre con tecla Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (modalConst && modalConst.style.display === 'flex') cerrarConstitucion();
        if (modalPruebas && modalPruebas.style.display === 'flex') cerrarPruebas();
      }
    });

    // Cierre haciendo clic en el backdrop
    if (modalConst) {
      modalConst.addEventListener('click', e => {
        if (e.target === modalConst) cerrarConstitucion();
      });
    }
    if (modalPruebas) {
      modalPruebas.addEventListener('click', e => {
        if (e.target === modalPruebas) cerrarPruebas();
      });
    }
  });

  // Exponer API global para llamadas de consola o tests
  window.ConstitucionSDD = {
    abrirConstitucion,
    cerrarConstitucion,
    abrirPruebas,
    cerrarPruebas,
    ejecutarPruebaDidactica,
    probarTodoEnBateria
  };
})();
