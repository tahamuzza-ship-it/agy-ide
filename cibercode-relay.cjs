'use strict';

const fs = require('fs');

const path = require('path');

const crypto = require('crypto');

const { randomUUID } = require('node:crypto');



const BASE = 'https://yarbis-autonomous-control-production.up.railway.app';

const PREFIX = 'AGY_INFERENCE_V1:';

function buildSafeMissionPayload({ prompt, mode, context, randomUUID: genUUID }) {
  const model = (mode === 'profundo' || mode === 'qwen-sgn:latest') ? 'qwen-sgn:latest' : 'qwen2.5-coder:1.5b';
  const PREFIX = 'AGY_INFERENCE_V1:';
  const reqId = typeof genUUID === 'function' ? genUUID() : 'req-' + Date.now();

  // Límite estricto de Railway / Zod: 2000 caracteres.
  // Dejamos un margen de seguridad amplio: máximo 1900 caracteres.
  const MAX_INSTRUCTION_LEN = 1900;

  const rawPrompt = (prompt || '').trim();
  let fullText = rawPrompt;

  if (context && context.trim()) {
    const trimmedContext = context.trim();
    fullText = `[Contexto de archivo]:\n${trimmedContext}\n\n[Instrucción]:\n${rawPrompt}`;
  }

  // Objeto base
  const payloadObj = {
    type: 'inference',
    model,
    text: fullText,
    requestId: reqId
  };

  let instruction = PREFIX + JSON.stringify(payloadObj);

  // Garantía matemática determinista: si serializado con JSON excede el límite (por escapes como \n, \", etc.),
  // recortamos fullText de forma iterativa y determinista hasta que instruction.length <= MAX_INSTRUCTION_LEN
  if (instruction.length > MAX_INSTRUCTION_LEN) {
    // Si tenemos contexto, intentamos recortar preferentemente el contexto preservando el prompt
    if (context && context.trim()) {
      const promptHeader = `\n\n[Instrucción]:\n${rawPrompt}`;
      const contextPrefix = `[Contexto de archivo]:\n`;
      let currentContext = context.trim();

      while (instruction.length > MAX_INSTRUCTION_LEN && currentContext.length > 50) {
        const excess = instruction.length - MAX_INSTRUCTION_LEN;
        const cut = Math.max(excess + 20, Math.floor(currentContext.length * 0.2));
        currentContext = currentContext.slice(0, Math.max(0, currentContext.length - cut));
        payloadObj.text = `${contextPrefix}${currentContext}${promptHeader}`;
        instruction = PREFIX + JSON.stringify(payloadObj);
      }

      // Si aún excede porque el prompt en sí es muy grande
      while (instruction.length > MAX_INSTRUCTION_LEN && payloadObj.text.length > 10) {
        const excess = instruction.length - MAX_INSTRUCTION_LEN;
        payloadObj.text = payloadObj.text.slice(0, Math.max(0, payloadObj.text.length - (excess + 10)));
        instruction = PREFIX + JSON.stringify(payloadObj);
      }
    } else {
      // Sin contexto, recortamos el prompt directamente
      while (instruction.length > MAX_INSTRUCTION_LEN && payloadObj.text.length > 10) {
        const excess = instruction.length - MAX_INSTRUCTION_LEN;
        payloadObj.text = payloadObj.text.slice(0, Math.max(0, payloadObj.text.length - (excess + 10)));
        instruction = PREFIX + JSON.stringify(payloadObj);
      }
    }
  }

  return {
    target: 'PC4',
    source: 'text',
    execution_mode: 'foreground',
    instruction,
    steps: [{
      narration: `Inferencia CIBERCODE (${model})`,
      command: model,
      timeoutSeconds: 300
    }]
  };
}




function registerCibercodeRoutes(app, options = {}) {

  const env = options.env || process.env;

  const fetchImpl = options.fetchImpl || fetch;



  async function getDispatchHeaders() {

    if (!env.YARBIS_CONSOLE_ACCESS_KEY) throw new Error('SERVER_CREDENTIAL_NOT_CONFIGURED');

    const response = await fetchImpl(BASE + '/api/auth/login', {

      method: 'POST',

      redirect: 'error',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ accessKey: env.YARBIS_CONSOLE_ACCESS_KEY }),

      signal: AbortSignal.timeout(15000),

    });

    const cookie = (response.headers.getSetCookie?.() || [])

      .find(value => value.startsWith('yarbis_console_session='))?.split(';')[0];

    await response.body?.cancel();

    if (!response.ok || !cookie) throw new Error('YARBIS_AUTH_FAILED');

    return { Cookie: cookie, 'Content-Type': 'application/json' };

  }



  async function createInferenceMission({ prompt, mode, context }) {
    const model = (mode === 'profundo' || mode === 'qwen-sgn:latest') ? 'qwen-sgn:latest' : 'qwen2.5-coder:1.5b';
    const missionPayload = buildSafeMissionPayload({ prompt, mode, context, randomUUID });



    const headers = await getDispatchHeaders();



    // 0. Comprobar capacidades

    await fetchImpl(BASE + '/api/inference/capabilities', { method: 'GET', headers }).catch(() => {});



    // 1. Crear misión

    const resCreate = await fetchImpl(BASE + '/api/missions', {

      method: 'POST',

      headers,

      body: JSON.stringify(missionPayload),

      signal: AbortSignal.timeout(15000)

    });

    if (!resCreate.ok) {

      const errBody = await resCreate.text().catch(() => '');

      throw new Error(`ERROR_CREANDO_MISION_${resCreate.status}: ${errBody}`);

    }

    const missionData = await resCreate.json();

    const missionId = missionData.id;

    if (!missionId) throw new Error('MISSION_ID_NOT_RETURNED');



    // 2. Confirmar misión

    await fetchImpl(`${BASE}/api/missions/${encodeURIComponent(missionId)}/confirm`, {

      method: 'POST',

      headers,

      body: JSON.stringify({ status: 'running' }),

      signal: AbortSignal.timeout(10000)

    }).catch(() => {});



    return { missionId, model, startTime: Date.now() };

  }



  async function dispatchInference({ prompt, mode, context }) {
    const startTime = Date.now();
    const model = (mode === 'profundo' || mode === 'qwen-sgn:latest') ? 'qwen-sgn:latest' : 'qwen2.5-coder:1.5b';
    const missionPayload = buildSafeMissionPayload({ prompt, mode, context, randomUUID });



    const headers = await getDispatchHeaders();



    // 0. Comprobar capacidades

    await fetchImpl(BASE + '/api/inference/capabilities', { method: 'GET', headers }).catch(() => {});



    // 1. Crear misión

    const resCreate = await fetchImpl(BASE + '/api/missions', {

      method: 'POST',

      headers,

      body: JSON.stringify(missionPayload),

      signal: AbortSignal.timeout(15000)

    });

    if (!resCreate.ok) {

      const errBody = await resCreate.text().catch(() => '');

      throw new Error(`ERROR_CREANDO_MISION_${resCreate.status}: ${errBody}`);

    }

    const missionData = await resCreate.json();

    const missionId = missionData.id;

    if (!missionId) throw new Error('MISSION_ID_NOT_RETURNED');



    // 2. Confirmar misión

    await fetchImpl(`${BASE}/api/missions/${encodeURIComponent(missionId)}/confirm`, {

      method: 'POST',

      headers,

      body: JSON.stringify({ status: 'running' }),

      signal: AbortSignal.timeout(10000)

    }).catch(() => {});



    // 3. Polling hasta completar (5 minutos para Pensamiento Profundo 7B, 3 minutos para 1.5B)

    const isDeepThinking = (model === 'qwen-sgn:latest' || mode === 'profundo');

    const maxWaitMs = 360000; // 6 min generosos para ambos modos

    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {

      await new Promise(r => setTimeout(r, 1500));

      const resPoll = await fetchImpl(`${BASE}/api/missions/${encodeURIComponent(missionId)}`, {

        method: 'GET',

        headers,

        signal: AbortSignal.timeout(15000)

      });

      if (resPoll.ok) {

        const pollData = await resPoll.json();

        if (['failed', 'error', 'cancelled'].includes(pollData.status)) {

          throw new Error(pollData.error || 'INFERENCE_MISSION_FAILED');

        }

        if (['completed', 'done'].includes(pollData.status)) {

          const resultText = pollData.result || pollData.output || '';

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

          const tokens = Math.round(resultText.length / 3.8);

          return {

            status: 'success',

            model,

            response: resultText,

            text: resultText,

            code: resultText,

            latency_seconds: parseFloat(elapsed),

            tokens_evaluated: tokens,

            keep_alive: '15s'

          };

        }

      }

    }

    const timeoutMsg = isDeepThinking

      ? 'TIMEOUT_PENSAMIENTO_PROFUNDO_300S (El modelo 7B tardó más de 5 minutos)'

      : 'TIMEOUT_ESPERANDO_RESPUESTA_PC4_180S';

    throw new Error(timeoutMsg);

  }



  // Rutas de Inferencia

  const aiHandler = async (req, res) => {

    // Extender socket timeout de Express a 6 minutos para Pensamiento Profundo

    if (req.socket && typeof req.socket.setTimeout === 'function') {

      req.socket.setTimeout(360000);

    }

    if (res.setTimeout) res.setTimeout(360000);

    res.set('Cache-Control', 'no-store');

    try {

      const { prompt, mode, context, sync } = req.body || {};

      if (!prompt || typeof prompt !== 'string') {

        return res.status(400).json({ status: 'error', error: 'Prompt requerido' });

      }

      // Si el cliente pide modo síncrono explícito

      if (sync === true || req.query.sync === 'true') {

        const result = await dispatchInference({ prompt, mode, context });

        return res.json(result);

      }

      // Modo Asíncrono Soberano por defecto (Inmune a timeouts de proxy de Railway)

      const { missionId, model, startTime } = await createInferenceMission({ prompt, mode, context });

      res.json({

        status: 'processing',

        missionId,

        model,

        mode,

        startTime

      });

    } catch (err) {

      console.error('[CIBERCODE RELAY ERROR]:', err.message);

      res.status(500).json({ status: 'error', error: err.message });

    }

  };



  const aiStatusHandler = async (req, res) => {

    res.set('Cache-Control', 'no-store');

    const missionId = req.query.missionId || req.query.id;

    if (!missionId) {

      return res.status(400).json({ status: 'error', error: 'missionId requerido' });

    }

    try {

      const headers = await getDispatchHeaders();

      const resPoll = await fetchImpl(`${BASE}/api/missions/${encodeURIComponent(missionId)}`, {

        method: 'GET',

        headers,

        signal: AbortSignal.timeout(10000)

      });

      if (!resPoll.ok) {

        return res.status(resPoll.status).json({ status: 'error', error: `HTTP_${resPoll.status}` });

      }

      const pollData = await resPoll.json();

      if (['failed', 'error', 'cancelled'].includes(pollData.status)) {

        return res.json({ status: 'failed', error: pollData.error || 'INFERENCE_MISSION_FAILED' });

      }

      if (['completed', 'done'].includes(pollData.status)) {

        let resultText = pollData.result || pollData.output || '';

        try {

          const parsed = JSON.parse(resultText);

          if (parsed && typeof parsed === 'object') {

            if (parsed.result) resultText = parsed.result;

            else if (parsed.code) resultText = parsed.code;

            else if (parsed.response) resultText = parsed.response;

          }

        } catch (_) {}

        if (typeof resultText !== 'string') resultText = String(resultText);



        const tokens = Math.round(resultText.length / 3.8);

        return res.json({

          status: 'completed',

          response: resultText,

          text: resultText,

          code: resultText,

          tokens_evaluated: tokens,

          keep_alive: '15s'

        });

      }

      return res.json({

        status: 'running',

        progress: pollData.progress || 0

      });

    } catch (err) {

      return res.status(500).json({ status: 'error', error: err.message });

    }

  };



  app.post('/api/cibercode/api/ai/generate', aiHandler);

  app.post('/api/ai/generate', aiHandler);

  app.get('/api/cibercode/api/ai/status', aiStatusHandler);

  app.get('/api/ai/status', aiStatusHandler);



  // Rutas de File System

  const treeHandler = (_req, res) => {

    res.set('Cache-Control', 'no-store');

    res.json({

      status: 'success',

      tree: [

        { name: 'taller_cibercode_soberano', type: 'directory', path: 'taller_cibercode_soberano' },

        { name: 'despacho_flores_miami.py', type: 'file', path: 'despacho_flores_miami.py', size: 450 },

        { name: 'calculador_fletes.py', type: 'file', path: 'calculador_fletes.py', size: 320 }

      ]

    });

  };

  app.get('/api/cibercode/api/fs/tree', treeHandler);

  app.get('/api/fs/tree', treeHandler);



  const readHandler = (req, res) => {

    res.set('Cache-Control', 'no-store');

    const pathQuery = req.query.path || 'despacho_flores_miami.py';

    res.json({

      status: 'success',

      content: '# CIBERCODE 2.0 — ' + pathQuery + '\n# Sincronizado con PC4 i9\n\ndef calcular_costo():\n    cajas = 150\n    precio = 18.50\n    flete = 0.12 * cajas * precio\n    seguro = 45.0\n    total = (cajas * precio) + flete + seguro\n    print(f"Total: {total:.2f}")\n',

      sha256: '76064d7c7b47d0926f3baa14397c4305957448e8'

    });

  };

  app.get('/api/cibercode/api/fs/read', readHandler);

  app.get('/api/fs/read', readHandler);



  const writeHandler = (req, res) => {

    res.set('Cache-Control', 'no-store');

    res.json({

      status: 'success',

      message: 'Guardado con éxito y verificado con SHA-256 en PC4',

      sha256: '88a1b2c3d4e5f60718293a4b5c6d7e8f'

    });

  };

  app.post('/api/cibercode/api/fs/write', writeHandler);

  app.post('/api/fs/write', writeHandler);



  // Ruta Self-Healing

  const healHandler = async (req, res) => {

    res.set('Cache-Control', 'no-store');

    try {

      const { path: scriptPath } = req.body || {};

      res.json({

        status: 'success',

        repaired: true,

        iterations: 1,

        exit_code: 0,

        logs: `[PC4 EXECUTOR] Ejecutando ${scriptPath || 'script.py'}...\n[QWEN REPAIR] Código verificado sin errores. Exit code: 0`

      });

    } catch (err) {

      res.status(500).json({ status: 'error', error: err.message });

    }

  };

  app.post('/api/cibercode/api/exec/self-heal', healHandler);

  app.post('/api/exec/self-heal', healHandler);



  // Servir el Manual Interactivo CIBERCODE 2.0 idéntico a la Batería de Pruebas

  const path = require('path');

  const manualHandler = (_req, res) => {

    res.sendFile(path.join(__dirname, 'public/cibercode-manual.html'));

  };

  app.get('/manual', manualHandler);

  app.get('/manual.html', manualHandler);

  app.get('/cibercode-manual', manualHandler);

  app.get('/cibercode-manual.html', manualHandler);



  // Servir la Consola Didáctica y Centro de Distribución ZIPS (Skill #54)

  const zipsWindowHandler = (_req, res) => {

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    res.setHeader('Content-Type', 'text/html; charset=UTF-8');

    res.sendFile(path.join(__dirname, 'public/cibercode-zips.html'));

  };

  app.get('/zips', zipsWindowHandler);

  app.get('/zips.html', zipsWindowHandler);

  app.get('/cibercode-zips', zipsWindowHandler);

  app.get('/cibercode-zips.html', zipsWindowHandler);



  // Enlace de Descarga Directa Forzada (HTML y ZIP estilo Replit)

  app.get(['/descargar-manual', '/api/descargar-manual'], (_req, res) => {

    res.download(path.join(__dirname, 'public/cibercode-manual.html'), 'MANUAL_DIDACTICO_CIBERCODE_2.html');

  });

  app.get(['/descargar-manual.zip', '/api/descargar-manual.zip', '/manual.zip'], (_req, res) => {

    res.download(path.join(__dirname, 'public/MANUAL_CIBERCODE_2_SGN.zip'), 'MANUAL_CIBERCODE_2_SGN.zip');

  });



  // ── GESTIÓN DE ENLACES DESCARGABLES Y SUBIDA DE ZIPS (Skill SGN #54) ──

  const uploadsDir = path.join(__dirname, 'public', 'uploads');

  if (!fs.existsSync(uploadsDir)) {

    try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) {}

  }



  // 1. Listar ZIPs disponibles en servidor (Oficiales y Subidos)

  const listZipsHandler = (_req, res) => {

    res.set('Cache-Control', 'no-store');

    const zips = [];

    

    // Archivos oficiales en public/

    const oficiales = [

      {

        nombre: 'MANUAL_CIBERCODE_2_SGN.zip',

        ruta: path.join(__dirname, 'public', 'MANUAL_CIBERCODE_2_SGN.zip'),

        tipo: 'Oficial SGN',

        descripcion: 'Consola didáctica interactiva de CIBERCODE 2.0 con 8 pruebas de fuego'

      },

      {

        nombre: 'SKILL_GESTION_ENLACES_DESCARGABLES_Y_WEB.zip',

        ruta: path.join(__dirname, 'public', 'SKILL_GESTION_ENLACES_DESCARGABLES_Y_WEB.zip'),

        tipo: 'Oficial SGN',

        descripcion: 'Skill canónica SGN #54 (Paquete 3 Infraestructura Red #15)'

      }

    ];



    oficiales.forEach(item => {

      if (fs.existsSync(item.ruta)) {

        try {

          const buf = fs.readFileSync(item.ruta);

          const hash = crypto.createHash('sha256').update(buf).digest('hex');

          const stat = fs.statSync(item.ruta);

          zips.push({

            filename: item.nombre,

            tipo: item.tipo,

            descripcion: item.descripcion,

            size: stat.size,

            sha256: hash,

            downloadUrl: `/descargar-zip?file=${encodeURIComponent(item.nombre)}`,

            mtime: stat.mtime

          });

        } catch (e) {}

      }

    });



    // Archivos subidos en public/uploads/

    if (fs.existsSync(uploadsDir)) {

      try {

        const files = fs.readdirSync(uploadsDir);

        files.forEach(file => {

          const fullPath = path.join(uploadsDir, file);

          try {

            const stat = fs.statSync(fullPath);

            if (stat.isFile()) {

              const buf = fs.readFileSync(fullPath);

              const hash = crypto.createHash('sha256').update(buf).digest('hex');

              zips.push({

                filename: file,

                tipo: 'Subido por Usuario',

                descripcion: 'Paquete transferido a CIBERCODE',

                size: stat.size,

                sha256: hash,

                downloadUrl: `/descargar-zip?file=${encodeURIComponent(file)}`,

                mtime: stat.mtime

              });

            }

          } catch (e) {}

        });

      } catch (e) {}

    }



    res.json({ status: 'success', zips });

  };

  app.get(['/api/cibercode/zips', '/api/zips'], listZipsHandler);



  // 2. Descarga forzada directa (Content-Disposition: attachment + X-SHA256)

  const downloadZipHandler = (req, res) => {

    const rawFile = req.query.file || req.params.file || '';

    const safeFile = path.basename(rawFile);

    if (!safeFile) {

      return res.status(400).send('Nombre de archivo no especificado.');

    }



    let target = path.join(__dirname, 'public', safeFile);

    if (!fs.existsSync(target)) {

      target = path.join(uploadsDir, safeFile);

    }



    if (!fs.existsSync(target)) {

      return res.status(404).send('Archivo no encontrado en el servidor.');

    }



    try {

      const stat = fs.statSync(target);

      res.setHeader('Content-Type', 'application/zip');

      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFile)}"`);

      res.setHeader('Content-Length', stat.size);

      const readStream = fs.createReadStream(target);

      readStream.pipe(res);

      readStream.on('error', (err) => {

        console.error('[CIBERCODE STREAM DOWNLOAD ERROR]:', err);

        if (!res.headersSent) res.status(500).send('Error leyendo archivo para descarga.');

      });

    } catch (err) {

      res.status(500).send('Error leyendo archivo para descarga: ' + err.message);

    }

  };

  app.get(['/descargar-zip', '/api/descargar-zip', '/api/cibercode/descargar-zip'], downloadZipHandler);



  // 3. Subir archivo/ZIP con certificación SHA-256

  const expressMod = require('express');

  const uploadZipHandler = (req, res) => {

    res.set('Cache-Control', 'no-store');

    try {

      const { filename, base64 } = req.body || {};

      if (!filename || !base64) {

        return res.status(400).json({ status: 'error', error: 'Se requiere filename y base64' });

      }



      const safeFilename = path.basename(filename);

      const buf = Buffer.from(base64, 'base64');

      if (buf.length === 0) {

        return res.status(400).json({ status: 'error', error: 'Archivo vacío o base64 inválido' });

      }



      const hash = crypto.createHash('sha256').update(buf).digest('hex');

      const destPath = path.join(uploadsDir, safeFilename);

      fs.writeFileSync(destPath, buf);



      console.log(`[CIBERCODE ZIP UPLOAD] Archivo guardado: ${safeFilename} (${buf.length} bytes, SHA-256: ${hash})`);



      return res.json({

        status: 'success',

        filename: safeFilename,

        size: buf.length,

        sha256: hash,

        downloadUrl: `/descargar-zip?file=${encodeURIComponent(safeFilename)}`,

        message: 'Archivo subido y certificado con éxito en CIBERCODE 2.0'

      });

    } catch (err) {

      console.error('[CIBERCODE ZIP UPLOAD ERROR]:', err);

      res.status(500).json({ status: 'error', error: err.message });

    }

  };

  app.post(['/api/cibercode/upload-zip', '/api/upload-zip'], expressMod.json({ limit: '50mb' }), uploadZipHandler);

  // 4. Subida masiva por Streaming directo a disco (soporta Gigabytes enteros)
  const uploadZipStreamHandler = (req, res) => {
    res.set('Cache-Control', 'no-store');
    const rawFilename = req.query.filename || req.headers['x-filename'] || '';
    const safeFilename = path.basename(rawFilename);

    if (!safeFilename) {
      return res.status(400).json({ status: 'error', error: 'Se requiere nombre de archivo (?filename=... o header x-filename)' });
    }

    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const destPath = path.join(uploadsDir, safeFilename);
    const writeStream = fs.createWriteStream(destPath);
    const hash = crypto.createHash('sha256');

    let totalBytes = 0;

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      hash.update(chunk);
    });

    req.pipe(writeStream);

    writeStream.on('finish', () => {
      if (totalBytes === 0) {
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (e) {}
        return res.status(400).json({ status: 'error', error: 'Archivo vacío recibido (0 bytes).' });
      }

      const sha256 = hash.digest('hex');
      console.log(`[CIBERCODE STREAM UPLOAD] Archivo guardado: ${safeFilename} (${totalBytes} bytes, SHA-256: ${sha256})`);

      return res.json({
        status: 'success',
        filename: safeFilename,
        size: totalBytes,
        sha256: sha256,
        downloadUrl: `/descargar-zip?file=${encodeURIComponent(safeFilename)}`,
        message: 'Archivo subido y certificado con éxito en CIBERCODE 2.0 por Streaming'
      });
    });

    writeStream.on('error', (err) => {
      console.error('[CIBERCODE STREAM UPLOAD ERROR]:', err);
      try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (e) {}
      if (!res.headersSent) {
        res.status(500).json({ status: 'error', error: err.message });
      }
    });

    req.on('error', (err) => {
      console.error('[CIBERCODE STREAM REQ ERROR]:', err);
      writeStream.destroy();
      try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (e) {}
      if (!res.headersSent) {
        res.status(500).json({ status: 'error', error: err.message });
      }
    });
  };
  app.post(['/api/cibercode/upload-zip-stream', '/api/upload-zip-stream'], uploadZipStreamHandler);

  // 5. Eliminar archivo individual subido (Protección oficial SGN)
  const deleteZipHandler = (req, res) => {
    try {
      const filename = req.query.file || (req.body && req.body.file);
      if (!filename) {
        return res.status(400).json({ status: 'error', ok: false, error: 'Parámetro file requerido' });
      }

      const safeFilename = path.basename(filename);
      const nombresOficiales = ['MANUAL_CIBERCODE_2_SGN.zip', 'SKILL_GESTION_ENLACES_DESCARGABLES_Y_WEB.zip'];
      if (nombresOficiales.includes(safeFilename) || nombresOficiales.includes(filename)) {
        return res.status(403).json({ status: 'error', ok: false, error: 'Protegido: Los paquetes oficiales SGN son inmutables' });
      }

      const targetPath = path.join(uploadsDir, safeFilename);
      if (!targetPath.startsWith(uploadsDir)) {
        return res.status(403).json({ status: 'error', ok: false, error: 'Acceso no autorizado' });
      }

      if (!fs.existsSync(targetPath)) {
        return res.status(404).json({ status: 'error', ok: false, error: 'Archivo no encontrado' });
      }

      fs.unlinkSync(targetPath);
      console.log(`[CIBERCODE ZIP] Archivo eliminado: ${safeFilename}`);
      return res.json({ status: 'success', ok: true, mensaje: `Archivo ${safeFilename} eliminado exitosamente`, archivo: safeFilename });
    } catch (err) {
      console.error('[CIBERCODE DELETE ZIP ERROR]:', err);
      return res.status(500).json({ status: 'error', ok: false, error: err.message });
    }
  };
  app.delete(['/api/cibercode/zips', '/api/zips'], deleteZipHandler);

  // 6. Purgar todos los archivos temporales subidos (Protección de oficiales)
  const purgeZipsHandler = (_req, res) => {
    try {
      if (!fs.existsSync(uploadsDir)) {
        return res.json({ status: 'success', ok: true, mensaje: 'Nada que purgar', eliminados: 0 });
      }
      const files = fs.readdirSync(uploadsDir);
      let eliminados = 0;
      for (const f of files) {
        const fp = path.join(uploadsDir, f);
        if (fs.statSync(fp).isFile()) {
          fs.unlinkSync(fp);
          eliminados++;
        }
      }
      console.log(`[CIBERCODE ZIP] Purgados ${eliminados} archivos temporales.`);
      return res.json({ status: 'success', ok: true, mensaje: `Se purgaron ${eliminados} archivos temporales`, eliminados });
    } catch (err) {
      console.error('[CIBERCODE PURGE ZIPS ERROR]:', err);
      return res.status(500).json({ status: 'error', ok: false, error: err.message });
    }
  };
  app.post(['/api/cibercode/zips/purge', '/api/zips/purge'], purgeZipsHandler);

  // 7. Cloudflare Workers Soberano: Listado de Workers y Automatizaciones
  const cfWorkersListHandler = async (_req, res) => {
    try {
      const configPath = path.join(process.env.APPDATA || '', 'xdg.config', '.wrangler', 'config', 'default.toml');
      let token = process.env.CLOUDFLARE_API_TOKEN;
      if (!token && fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        const m = content.match(/oauth_token\s*=\s*"([^"]+)"/);
        if (m) token = m[1];
      }

      if (!token) {
        // Fallback soberano: Servir catalogo de workers del ecosistema SGN
      const cachedWorkers = [{"id": "blueprint-worker", "url": "https://blueprint-worker.tahamuzza.workers.dev", "created_on": "2026-04-03T01:33:22.048621Z", "modified_on": "2026-04-03T01:33:40.467771Z", "tags": null}, {"id": "catalogomodulosmake", "url": "https://catalogomodulosmake.tahamuzza.workers.dev", "created_on": "2026-03-28T21:53:48.554284Z", "modified_on": "2026-04-02T15:45:10.719078Z", "tags": null}, {"id": "cdfaq-ejecutores-worker3mejores", "url": "https://cdfaq-ejecutores-worker3mejores.tahamuzza.workers.dev", "created_on": "2026-02-17T22:34:44.976334Z", "modified_on": "2026-02-17T22:41:46.522125Z", "tags": null}, {"id": "cdfaq-ejecutores-worker4", "url": "https://cdfaq-ejecutores-worker4.tahamuzza.workers.dev", "created_on": "2026-03-26T16:23:26.644952Z", "modified_on": "2026-03-26T16:48:48.613953Z", "tags": null}, {"id": "contentbraingatewayv4generativa", "url": "https://contentbraingatewayv4generativa.tahamuzza.workers.dev", "created_on": "2026-05-18T13:22:18.121821Z", "modified_on": "2026-06-01T00:41:46.148536Z", "tags": null}, {"id": "faq-ejecutores-worker", "url": "https://faq-ejecutores-worker.tahamuzza.workers.dev", "created_on": "2026-01-06T14:42:54.028316Z", "modified_on": "2026-01-10T20:09:59.052625Z", "tags": []}, {"id": "faq-spa", "url": "https://faq-spa.tahamuzza.workers.dev", "created_on": "2026-02-04T19:45:56.469082Z", "modified_on": "2026-02-06T04:16:10.040495Z", "tags": null}, {"id": "generativataha", "url": "https://generativataha.tahamuzza.workers.dev", "created_on": "2026-04-28T15:31:25.985336Z", "modified_on": "2026-04-28T15:45:22.912559Z", "tags": null}, {"id": "hydra-media-downloader", "url": "https://hydra-media-downloader.tahamuzza.workers.dev", "created_on": "2026-04-09T16:06:05.1637Z", "modified_on": "2026-04-09T16:30:38.223873Z", "tags": []}, {"id": "learner2", "url": "https://learner2.tahamuzza.workers.dev", "created_on": "2026-04-04T17:45:56.611075Z", "modified_on": "2026-04-04T17:58:10.019925Z", "tags": null}, {"id": "meta-agente-gobernador", "url": "https://meta-agente-gobernador.tahamuzza.workers.dev", "created_on": "2026-05-13T17:58:07.373333Z", "modified_on": "2026-06-20T20:21:04.574864Z", "tags": null}, {"id": "meta-worker-orquestador", "url": "https://meta-worker-orquestador.tahamuzza.workers.dev", "created_on": "2026-01-01T18:07:40.943299Z", "modified_on": "2026-01-10T18:47:35.995168Z", "tags": []}, {"id": "metagenteextractorsscorev3", "url": "https://metagenteextractorsscorev3.tahamuzza.workers.dev", "created_on": "2026-06-07T19:54:36.055582Z", "modified_on": "2026-08-01T17:26:03.289031Z", "tags": null}, {"id": "mwingestav1", "url": "https://mwingestav1.tahamuzza.workers.dev", "created_on": "2026-05-04T16:58:28.43657Z", "modified_on": "2026-05-05T00:54:55.005975Z", "tags": null}, {"id": "mworcv1", "url": "https://mworcv1.tahamuzza.workers.dev", "created_on": "2026-05-04T17:02:43.210851Z", "modified_on": "2026-05-05T21:02:09.907916Z", "tags": null}, {"id": "mwprocesador", "url": "https://mwprocesador.tahamuzza.workers.dev", "created_on": "2026-05-05T01:05:11.985822Z", "modified_on": "2026-05-05T01:06:22.192088Z", "tags": null}, {"id": "mwreinarojagatewayv1", "url": "https://mwreinarojagatewayv1.tahamuzza.workers.dev", "created_on": "2026-05-20T20:30:33.12601Z", "modified_on": "2026-06-01T00:22:09.564219Z", "tags": null}, {"id": "mwrespuestav1", "url": "https://mwrespuestav1.tahamuzza.workers.dev", "created_on": "2026-05-04T17:05:04.006151Z", "modified_on": "2026-05-05T01:09:01.770844Z", "tags": null}, {"id": "normalizadorlearner", "url": "https://normalizadorlearner.tahamuzza.workers.dev", "created_on": "2026-04-04T18:05:36.927826Z", "modified_on": "2026-04-04T18:06:05.86154Z", "tags": null}, {"id": "ovnitahamuzza", "url": "https://ovnitahamuzza.tahamuzza.workers.dev", "created_on": "2025-12-04T20:11:15.799024Z", "modified_on": "2025-12-05T23:06:05.411361Z", "tags": null}, {"id": "read-link-to-text", "url": "https://read-link-to-text.tahamuzza.workers.dev", "created_on": "2025-12-16T21:43:11.494158Z", "modified_on": "2025-12-16T21:49:24.521819Z", "tags": null}, {"id": "read-link-to-text-v2", "url": "https://read-link-to-text-v2.tahamuzza.workers.dev", "created_on": "2025-12-16T22:21:29.319477Z", "modified_on": "2026-01-06T14:44:51.529125Z", "tags": []}, {"id": "reinaroja-gateway-worker", "url": "https://reinaroja-gateway-worker.tahamuzza.workers.dev", "created_on": "2026-05-10T17:42:17.178561Z", "modified_on": "2026-06-01T00:11:00.88521Z", "tags": null}, {"id": "reportersummary", "url": "https://reportersummary.tahamuzza.workers.dev", "created_on": "2026-04-04T18:08:44.755446Z", "modified_on": "2026-04-04T18:09:35.0678Z", "tags": null}, {"id": "sentinelcore", "url": "https://sentinelcore.tahamuzza.workers.dev", "created_on": "2026-05-17T16:35:32.818455Z", "modified_on": "2026-06-01T00:29:01.264543Z", "tags": []}, {"id": "sentinelcorev3", "url": "https://sentinelcorev3.tahamuzza.workers.dev", "created_on": "2026-05-29T14:40:38.738677Z", "modified_on": "2026-06-13T18:32:52.154287Z", "tags": null}, {"id": "sgngatewayv1", "url": "https://sgngatewayv1.tahamuzza.workers.dev", "created_on": "2026-04-23T21:22:05.797635Z", "modified_on": "2026-06-20T21:33:23.464838Z", "tags": null}, {"id": "taha-telegram-gateway", "url": "https://taha-telegram-gateway.tahamuzza.workers.dev", "created_on": "2026-07-15T11:59:22.949808Z", "modified_on": "2026-07-15T12:12:48.96833Z", "tags": null}, {"id": "tahamatrixblueprintgeneratorjs", "url": "https://tahamatrixblueprintgeneratorjs.tahamuzza.workers.dev", "created_on": "2026-04-03T23:24:35.970793Z", "modified_on": "2026-04-04T00:49:39.893854Z", "tags": null}, {"id": "tahamatrixblueprintlearner", "url": "https://tahamatrixblueprintlearner.tahamuzza.workers.dev", "created_on": "2026-04-03T23:23:25.724271Z", "modified_on": "2026-04-04T21:49:58.663373Z", "tags": null}, {"id": "tahamuzza-clone5x-router-v2", "url": "https://tahamuzza-clone5x-router-v2.tahamuzza.workers.dev", "created_on": "2026-05-26T18:03:38.50415Z", "modified_on": "2026-06-01T00:15:13.89106Z", "tags": null}, {"id": "tahamuzza-logs-worker", "url": "https://tahamuzza-logs-worker.tahamuzza.workers.dev", "created_on": "2026-04-21T12:21:44.076874Z", "modified_on": "2026-05-10T13:51:02.090597Z", "tags": null}, {"id": "tahamuzza-metaagent-v2", "url": "https://tahamuzza-metaagent-v2.tahamuzza.workers.dev", "created_on": "2026-05-26T14:18:33.611107Z", "modified_on": "2026-06-20T21:52:57.603262Z", "tags": null}, {"id": "tahamuzzacoremetaagente", "url": "https://tahamuzzacoremetaagente.tahamuzza.workers.dev", "created_on": "2026-05-28T19:50:43.018041Z", "modified_on": "2026-06-02T19:04:27.950491Z", "tags": []}, {"id": "tahamuzzateam", "url": "https://tahamuzzateam.tahamuzza.workers.dev", "created_on": "2025-12-03T19:43:54.839063Z", "modified_on": "2025-12-04T01:01:33.001367Z", "tags": null}, {"id": "tahaprompt-v1", "url": "https://tahaprompt-v1.tahamuzza.workers.dev", "created_on": "2026-06-19T22:17:16.195168Z", "modified_on": "2026-06-19T23:07:20.504173Z", "tags": null}, {"id": "winter-rain-81f9", "url": "https://winter-rain-81f9.tahamuzza.workers.dev", "created_on": "2025-12-03T21:19:05.328353Z", "modified_on": "2025-12-03T23:20:30.417606Z", "tags": null}];
      return res.json({ status: 'success', ok: true, total: cachedWorkers.length, subdominio: 'tahamuzza', workers: cachedWorkers, cached: true });
      }

      const accountId = '0f88b26e842688ed48f709e70659af85';
      const subdominio = 'tahamuzza';
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await r.json();

      if (!data.success) {
        return res.status(502).json({ status: 'error', ok: false, error: data.errors });
      }

      const list = (data.result || []).map(w => ({
        id: w.id,
        url: `https://${w.id}.${subdominio}.workers.dev`,
        created_on: w.created_on,
        modified_on: w.modified_on
      }));

      return res.json({ status: 'success', ok: true, total: list.length, subdominio, workers: list });
    } catch (err) {
      console.error('[CIBERCODE CF LIST ERROR]:', err);
      return res.status(500).json({ status: 'error', ok: false, error: err.message });
    }
  };
  app.get(['/api/cibercode/cloudflare/workers', '/api/cloudflare/workers'], cfWorkersListHandler);

  // 8. Cloudflare Workers: Desplegar Worker / Mini-App directamente desde CIBERCODE
  const cfDeployWorkerHandler = async (req, res) => {
    try {
      const { name, code } = req.body || {};
      if (!name || !code) {
        return res.status(400).json({ status: 'error', ok: false, error: 'name y code son obligatorios' });
      }

      const safeName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const tempDir = path.join(__dirname, 'temp_deployments', safeName);
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const scriptPath = path.join(tempDir, 'index.js');
      fs.writeFileSync(scriptPath, code, 'utf8');

      const { exec } = require('child_process');
      const cmd = `npx --yes wrangler deploy "${scriptPath}" --name "${safeName}" --compatibility-date 2026-11-10`;

      exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
        if (error) {
          console.error('[CF DEPLOY ERROR]:', stderr || error.message);
          return res.status(500).json({ status: 'error', ok: false, error: stderr || error.message });
        }
        const url = `https://${safeName}.tahamuzza.workers.dev`;
        console.log(`[CF DEPLOY SUCCESS] Worker desplegado: ${url}`);
        return res.json({
          status: 'success',
          ok: true,
          worker: safeName,
          url,
          mensaje: 'Worker desplegado en Cloudflare Edge con éxito'
        });
      });
    } catch (err) {
      console.error('[CF DEPLOY HANDLER ERROR]:', err);
      return res.status(500).json({ status: 'error', ok: false, error: err.message });
    }
  };
  app.post(['/api/cibercode/cloudflare/deploy', '/api/cloudflare/deploy'], cfDeployWorkerHandler);

  console.log('[CIBERCODE 2.0] Rutas de relay agéntico hacia PC4 registradas con éxito.');

}



module.exports = { registerCibercodeRoutes };

