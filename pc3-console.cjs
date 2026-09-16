'use strict';

const { randomUUID } = require('crypto');

// This is the public Railway hostname of the existing Yarbis Control
// deployment.  YARBIS_CONTROL_URL may replace it in a private deployment.
const DEFAULT_YARBIS_CONTROL_URL =
  'https://yarbis-autonomous-control-production.up.railway.app';
const TARGET_NODE = 'PC-MIAMI';
const COMMAND_MAX_LENGTH = 4000;
const COMMAND_TTL_MS = 15 * 60 * 1000;
const COMMAND_MAP_MAX = 512;
const CONNECT_TIMEOUT_MS = 5000;
const SEND_CALLBACK_TIMEOUT_MS = 1500;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

class Pc3ConsoleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Pc3ConsoleError';
    this.code = code;
  }
}

function safeErrorMessage(error, fallback) {
  if (error instanceof Pc3ConsoleError) return error.message;
  return fallback;
}

function makeUpstreamConfig(env, accessKeyOverride) {
  const accessKey = String(
    accessKeyOverride !== undefined
      ? accessKeyOverride
      : env.YARBIS_CONSOLE_ACCESS_KEY || '',
  ).trim();
  if (!accessKey) {
    throw new Pc3ConsoleError(
      'AUTH_ERROR',
      'Yarbis console access key is not configured.',
    );
  }

  const configuredUrl = String(
    env.YARBIS_CONTROL_URL || DEFAULT_YARBIS_CONTROL_URL,
  ).trim();
  let base;
  try {
    base = new URL(configuredUrl);
  } catch {
    throw new Pc3ConsoleError('UPSTREAM_CONFIG', 'Yarbis Control URL is invalid.');
  }
  if (
    (base.protocol !== 'http:' && base.protocol !== 'https:') ||
    base.username ||
    base.password
  ) {
    throw new Pc3ConsoleError(
      'UPSTREAM_CONFIG',
      'Yarbis Control URL must be an HTTP(S) URL without credentials.',
    );
  }

  // Keep any deployment prefix, but never accept a browser-provided path,
  // query, role, target, or token.
  const prefix = base.pathname.replace(/\/+$/, '');
  const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = new URL(
    `${prefix}/api/terminal/ws`,
    `${protocol}//${base.host}`,
  );
  wsUrl.searchParams.set('role', 'commander');
  wsUrl.searchParams.set('node_id', TARGET_NODE);
  return {
    accessKey,
    wsUrl: wsUrl.toString(),
    authorization: `Bearer ${accessKey}`,
  };
}

function websocketOpen(socket) {
  // Minimal test doubles often omit readyState; their `open` event still
  // establishes the same invariant as ws.OPEN.
  return Boolean(
    socket && (socket.readyState === OPEN || socket.readyState === undefined),
  );
}

function normalizedNodeId(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function systemNodeMatches(message, text) {
  const declared =
    message.node_id || message.nodeId || message.target || message.targetNode;
  if (declared && normalizedNodeId(declared) !== TARGET_NODE) return false;
  // A PC1 system line must never make the fixed PC-MIAMI target look online.
  if (
    /\bPC1\b/i.test(text) &&
    !new RegExp(`\\b${TARGET_NODE}\\b`, 'i').test(text)
  ) {
    return false;
  }
  return true;
}

function onlineFromSystem(message) {
  const text = typeof message.text === 'string' ? message.text : '';
  if (!systemNodeMatches(message, text)) return null;
  if (message.online === true || message.connected === true) return true;
  if (message.online === false || message.connected === false) return false;
  if (
    /esperando\s+conexi[oó]n|no\s+est[aá]\s+conectad[oa]|desconectad[oa]|\boffline\b/i.test(
      text,
    )
  ) {
    return false;
  }
  if (
    /nodo\s+(?:pc-miami\s+)?conectad[oa]\s+en\s+vivo|nodo\s+en\s+l[ií]nea|streaming\s+activo|[-=]>?\s*[🟢]?\s*en\s+l[ií]nea/i.test(
      text,
    )
  ) {
    return true;
  }
  return null;
}

function dataToString(data) {
  if (data && typeof data === 'object' && 'data' in data) data = data.data;
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
      'utf8',
    );
  }
  return '';
}

function commandResultFields(message) {
  const value =
    message && message.result && typeof message.result === 'object'
      ? message.result
      : message;
  if (!value || typeof value !== 'object') {
    return {
      hasEnvelope: false,
      stdout: '',
      stderr: '',
      exit_code: null,
      timeout: false,
    };
  }
  const hasEnvelope =
    Object.prototype.hasOwnProperty.call(value, 'stdout') ||
    Object.prototype.hasOwnProperty.call(value, 'stderr') ||
    Object.prototype.hasOwnProperty.call(value, 'exit_code') ||
    Object.prototype.hasOwnProperty.call(value, 'exitcode') ||
    Object.prototype.hasOwnProperty.call(value, 'timeout');
  const rawExitCode = Object.prototype.hasOwnProperty.call(value, 'exit_code')
    ? value.exit_code
    : value.exitcode;
  return {
    hasEnvelope,
    stdout: typeof value.stdout === 'string' ? value.stdout : '',
    stderr: typeof value.stderr === 'string' ? value.stderr : '',
    exit_code: rawExitCode === undefined ? null : rawExitCode,
    timeout: value.timeout === true,
  };
}

function appendDiagnostic(output, diagnostic) {
  if (!output) return diagnostic;
  return `${output}${/[\r\n]$/.test(output) ? '' : '\n'}${diagnostic}`;
}

function readableResult(fields, fallback) {
  let output = fields.stdout;
  if (fields.stderr) {
    output = appendDiagnostic(output, `[stderr]\n${fields.stderr}`);
  }
  if (fields.timeout) {
    output = appendDiagnostic(output, '[timeout] Command timed out.');
  }
  const failedExit =
    fields.exit_code !== null &&
    fields.exit_code !== undefined &&
    Number(fields.exit_code) !== 0;
  if (failedExit) {
    output = appendDiagnostic(output, `[exit=${fields.exit_code}] Command failed.`);
  }
  if (output) return output;
  if (fields.hasEnvelope && failedExit) {
    return `[exit=${fields.exit_code}] Command failed.`;
  }
  if (fields.hasEnvelope && fields.timeout) return '[timeout] Command timed out.';
  return typeof fallback === 'string' ? fallback : '';
}

function createPc3ConsoleAdapter(options = {}) {
  const env = options.env || process.env;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const commandTtlMs = Number.isFinite(options.commandTtlMs)
    ? Math.max(1, Number(options.commandTtlMs))
    : COMMAND_TTL_MS;
  const commandMapMax = Number.isInteger(options.commandMapMax)
    ? Math.max(1, options.commandMapMax)
    : COMMAND_MAP_MAX;
  const connectTimeoutMs = Number.isFinite(options.connectTimeoutMs)
    ? Math.max(1, Number(options.connectTimeoutMs))
    : CONNECT_TIMEOUT_MS;
  const accessKeyOverride = Object.prototype.hasOwnProperty.call(
    options,
    'accessKey',
  )
    ? options.accessKey
    : undefined;

  let socket = null;
  let generation = 0;
  let connectPromise = null;
  let handshakePromise = null;
  let handshakeResolve = null;
  let handshakeReject = null;
  let handshakeTimer = null;
  let handshakeComplete = false;
  let handshakeError = null;
  let connected = false;
  let online = false;
  let lastError = null;
  const commands = new Map();

  function closeHandshakeTimer() {
    if (handshakeTimer) {
      clearTimeout(handshakeTimer);
      handshakeTimer = null;
    }
  }

  function setLastError(code, message) {
    lastError = { code, message };
  }

  function settleHandshake(error) {
    closeHandshakeTimer();
    handshakeComplete = true;
    handshakeError = error || null;
    const pendingResolve = handshakeResolve;
    const pendingReject = handshakeReject;
    handshakePromise = null;
    handshakeResolve = null;
    handshakeReject = null;
    if (!pendingResolve || !pendingReject) return;
    if (error) pendingReject(error);
    else pendingResolve();
  }

  function markPendingCommandsUncertain(message) {
    const timestamp = now();
    for (const record of commands.values()) {
      if (record.status !== 'pending') continue;
      record.status = 'error';
      record.result = message;
      record.updatedAt = timestamp;
    }
  }

  function cleanupCommands() {
    const timestamp = now();
    for (const [id, record] of commands) {
      if (timestamp - record.createdAt <= commandTtlMs) continue;
      if (record.status === 'pending') {
        record.status = 'error';
        record.result =
          'Delivery uncertain: command record expired before a result arrived; the command was not retried.';
        record.updatedAt = timestamp;
      } else {
        commands.delete(id);
      }
    }

    if (commands.size <= commandMapMax) return;
    // Evict only terminal records.  A pending command is never overwritten.
    for (const [id, record] of commands) {
      if (commands.size <= commandMapMax) break;
      if (record.status !== 'pending') commands.delete(id);
    }
  }

  function newCommandId() {
    cleanupCommands();
    if (commands.size >= commandMapMax) {
      // Terminal records are bounded cache entries; remove the oldest ones
      // before rejecting.  Pending records are never evicted or overwritten.
      for (const [id, record] of commands) {
        if (commands.size < commandMapMax) break;
        if (record.status !== 'pending') commands.delete(id);
      }
    }
    if (commands.size >= commandMapMax) {
      throw new Pc3ConsoleError(
        'COMMAND_MAP_FULL',
        'The command result map is full; no command was queued.',
      );
    }
    let id;
    do {
      id = randomUUID();
    } while (commands.has(id));
    return id;
  }

  function upstreamError(code, message) {
    return new Pc3ConsoleError(code, message);
  }

  function attachSocketHandlers(activeSocket, activeGeneration) {
    const isCurrent = () =>
      socket === activeSocket && generation === activeGeneration;
    let openedHandled = false;

    const onOpen = () => {
      if (!isCurrent() || openedHandled) return;
      openedHandled = true;
      connected = true;
      online = false;
      lastError = null;
      handshakeComplete = false;
      handshakeError = null;
      handshakePromise = new Promise((resolve, reject) => {
        handshakeResolve = resolve;
        handshakeReject = reject;
        handshakeTimer = setTimeout(() => {
          const error = upstreamError(
            'UPSTREAM_TIMEOUT',
            'Yarbis Control did not report terminal status.',
          );
          setLastError('UPSTREAM_TIMEOUT', error.message);
          settleHandshake(error);
        }, connectTimeoutMs);
      });
      try {
        // The existing Yarbis terminal websocket requires this exact routing
        // frame before accepting input.  Its target is deliberately fixed.
        activeSocket.send(
          JSON.stringify({ type: 'switch_node', target: TARGET_NODE }),
        );
      } catch {
        settleHandshake(
          upstreamError(
            'UPSTREAM_SEND',
            'Yarbis Control commander channel is unavailable.',
          ),
        );
      }
    };

    const onMessage = (raw) => {
      if (!isCurrent()) return;
      let message;
      try {
        message = JSON.parse(dataToString(raw));
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') return;

      if (message.type === 'system') {
        const nextOnline = onlineFromSystem(message);
        if (nextOnline !== null) online = nextOnline;
        if (handshakePromise) settleHandshake();
        return;
      }

      if (message.type !== 'output' && message.type !== 'result') return;
      const result =
        message.result && typeof message.result === 'object'
          ? message.result
          : message;
      const declaredResultNode =
        result && (result.node_id || result.nodeId || result.target);
      if (
        declaredResultNode &&
        normalizedNodeId(declaredResultNode) !== TARGET_NODE
      ) {
        return;
      }
      const id =
        result && typeof result.id === 'string'
          ? result.id
          : typeof message.id === 'string'
            ? message.id
            : '';
      // Results are correlated only against IDs allocated by this adapter.
      // In particular, PC1 or another commander cannot complete our records.
      const record = id ? commands.get(id) : undefined;
      if (!record || record.status !== 'pending') return;
      const fields = commandResultFields(message);
      const failed =
        fields.timeout ||
        (fields.exit_code !== null &&
          fields.exit_code !== undefined &&
          Number(fields.exit_code) !== 0) ||
        (fields.exit_code === null && Boolean(fields.stderr));
      record.status = failed ? 'error' : 'done';
      record.result = readableResult(fields, typeof message.text === 'string' ? message.text : '');
      if (fields.hasEnvelope) {
        record.stdout = fields.stdout;
        record.stderr = fields.stderr;
        record.exit_code = fields.exit_code;
        record.timeout = fields.timeout;
      }
      record.updatedAt = now();
    };

    const onError = () => {
      if (!isCurrent()) return;
      // Never include the ws error or URL: either could contain deployment
      // details, and neither is useful to a browser caller.
      setLastError('UPSTREAM_ERROR', 'Yarbis Control WebSocket error.');
    };

    const onUnexpectedResponse = (request, response) => {
      if (!isCurrent()) return;
      const statusCode = response?.statusCode ?? request?.statusCode;
      if (statusCode === 401) {
        setLastError('AUTH_ERROR', 'Yarbis Control rejected console authentication.');
      } else {
        setLastError('UPSTREAM_ERROR', 'Yarbis Control rejected the commander channel.');
      }
      settleHandshake(
        upstreamError(
          lastError.code,
          lastError.message,
        ),
      );
    };

    const onClose = () => {
      if (!isCurrent()) return;
      connected = false;
      online = false;
      socket = null;
      const uncertainty =
        'Delivery uncertain: the commander WebSocket disconnected after dispatch; the command may have reached PC-MIAMI and was not retried.';
      markPendingCommandsUncertain(uncertainty);
      const error = upstreamError('DISCONNECTED', uncertainty);
      settleHandshake(error);
      if (!lastError) setLastError('DISCONNECTED', 'Yarbis Control commander channel disconnected.');
    };

    const bind = (name, handler) => {
      if (typeof activeSocket.on === 'function') {
        activeSocket.on(name, handler);
      } else if (typeof activeSocket.addEventListener === 'function') {
        activeSocket.addEventListener(name, handler);
      } else {
        activeSocket[`on${name}`] = handler;
      }
    };
    if (
      typeof activeSocket.on !== 'function' &&
      typeof activeSocket.addEventListener !== 'function' &&
      !activeSocket
    ) {
      throw upstreamError(
        'UPSTREAM_CONFIG',
        'The Yarbis commander WebSocket is not event-capable.',
      );
    }
    bind('open', onOpen);
    bind('message', onMessage);
    bind('error', onError);
    bind('close', onClose);
    bind('unexpected-response', onUnexpectedResponse);
    // A small fake WebSocket may transition to OPEN in its constructor before
    // event handlers can be attached.  Treat that state as one open event.
    if (websocketOpen(activeSocket) && !connected) onOpen();
  }

  function constructSocket(config) {
    const wsOptions = {
      headers: { Authorization: config.authorization },
      maxPayload: 4 * 1024 * 1024,
    };
    if (typeof options.wsFactory === 'function') {
      return options.wsFactory(config.wsUrl, wsOptions);
    }
    if (typeof options.createWebSocket === 'function') {
      return options.createWebSocket(config.wsUrl, wsOptions);
    }
    const WebSocket = options.WebSocket || options.fakeWS || require('ws');
    return new WebSocket(config.wsUrl, wsOptions);
  }

  function connect() {
    if (connectPromise) return connectPromise;
    let config;
    try {
      config = makeUpstreamConfig(env, accessKeyOverride);
    } catch (error) {
      return Promise.reject(error);
    }

    const activeGeneration = ++generation;
    connectPromise = new Promise((resolve, reject) => {
      let openTimer = setTimeout(() => {
        openTimer = null;
        setLastError('UPSTREAM_TIMEOUT', 'Yarbis Control commander channel timed out.');
        const error = upstreamError(
          'UPSTREAM_TIMEOUT',
          'Yarbis Control commander channel timed out.',
        );
        if (activeSocket && socket === activeSocket) {
          socket = null;
          connected = false;
          online = false;
          generation += 1;
          if (
            activeSocket.readyState !== CLOSING &&
            activeSocket.readyState !== CLOSED &&
            typeof activeSocket.close === 'function'
          ) {
            try {
              activeSocket.close();
            } catch {
              // The timeout is already the authoritative upstream error.
            }
          }
        }
        settleHandshake(error);
        reject(error);
      }, connectTimeoutMs);

      let activeSocket;
      try {
        activeSocket = constructSocket(config);
        socket = activeSocket;
        attachSocketHandlers(activeSocket, activeGeneration);
      } catch {
        clearTimeout(openTimer);
        setLastError('UPSTREAM_ERROR', 'Yarbis Control commander channel is unavailable.');
        reject(
          upstreamError(
            'UPSTREAM_ERROR',
            'Yarbis Control commander channel is unavailable.',
          ),
        );
        return;
      }

      const resolveWhenReady = () => {
        if (!openTimer) return;
        clearTimeout(openTimer);
        openTimer = null;
        resolve();
      };
      const rejectWhenReady = (error) => {
        if (!openTimer) return;
        clearTimeout(openTimer);
        openTimer = null;
        reject(error);
      };

      // Event handlers above deliberately stay small and do not capture a
      // promise.  Polling the state here also supports minimal fake WebSockets
      // that emit `open` synchronously or do not expose EventEmitter.once.
      const waitForHandshake = () => {
        if (!activeSocket || !websocketOpen(activeSocket)) {
          if (activeSocket && activeSocket.readyState === CLOSED) {
            rejectWhenReady(
              upstreamError(
                lastError?.code || 'UPSTREAM_ERROR',
                lastError?.message || 'Yarbis Control commander channel is unavailable.',
              ),
            );
          } else if (openTimer) {
            setTimeout(waitForHandshake, 10);
          }
          return;
        }
        if (!handshakePromise) {
          if (handshakeComplete) {
            if (handshakeError) rejectWhenReady(handshakeError);
            else resolveWhenReady();
            return;
          }
          // The open handler has not run yet; allow it to run on the next
          // event-loop turn for fake sockets.
          if (openTimer) setTimeout(waitForHandshake, 10);
          return;
        }
        handshakePromise.then(resolveWhenReady, rejectWhenReady);
      };
      waitForHandshake();
    }).finally(() => {
      connectPromise = null;
    });
    return connectPromise;
  }

  async function ensureConnected() {
    if (websocketOpen(socket) && handshakeComplete && !handshakeError && connected) {
      return;
    }
    await connect();
  }

  async function status() {
    cleanupCommands();
    try {
      await ensureConnected();
    } catch (error) {
      const message = safeErrorMessage(
        error,
        lastError?.message || 'Yarbis Control commander channel is unavailable.',
      );
      return {
        ok: false,
        online: false,
        connected: false,
        error: message,
      };
    }
    const response = {
      ok: true,
      online: Boolean(online && connected),
      connected: Boolean(connected && websocketOpen(socket)),
    };
    if (!response.online) response.error = 'PC-MIAMI is offline.';
    return response;
  }

  async function submitCommand(command) {
    if (
      typeof command !== 'string' ||
      command.length > COMMAND_MAX_LENGTH ||
      /[\r\n\u2028\u2029]/.test(command) ||
      !command.trim()
    ) {
      throw new Pc3ConsoleError(
        'COMMAND_INVALID',
        'command must be a non-empty single-line string of at most 4000 characters.',
      );
    }
    cleanupCommands();
    try {
      await ensureConnected();
    } catch (error) {
      throw new Pc3ConsoleError(
        error instanceof Pc3ConsoleError ? error.code : 'UPSTREAM_ERROR',
        safeErrorMessage(
          error,
          lastError?.message || 'Yarbis Control commander channel is unavailable.',
        ),
      );
    }
    if (!connected || !websocketOpen(socket) || !online) {
      throw new Pc3ConsoleError(
        'OFFLINE',
        'PC-MIAMI is offline; no command was queued.',
      );
    }

    const id = newCommandId();
    const record = {
      id,
      status: 'pending',
      result: '',
      createdAt: now(),
      updatedAt: now(),
    };
    // Register before send so a deterministic fake or an unusually fast
    // upstream cannot deliver a result in the same turn and be discarded.
    // It is removed again if the send itself fails, so failed sends are never
    // exposed as queued commands.
    commands.set(id, record);
    const activeSocket = socket;
    try {
      // No HTTP queue/fallback is used.  The only upstream command frame is
      // the existing terminal-websocket `input` contract.
      const payload = JSON.stringify({ type: 'input', id, cmd: command });
      if (typeof activeSocket.send !== 'function') throw new Error('send unavailable');
      if (activeSocket.send.length >= 2) {
        await new Promise((resolve, reject) => {
          let settled = false;
          const finish = (error) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            if (error) reject(error);
            else resolve();
          };
          const timer = setTimeout(() => finish(), SEND_CALLBACK_TIMEOUT_MS);
          try {
            activeSocket.send(payload, finish);
          } catch (error) {
            finish(error);
          }
        });
      } else {
        activeSocket.send(payload);
      }
    } catch {
      if (commands.get(id) === record) commands.delete(id);
      throw new Pc3ConsoleError(
        'UPSTREAM_SEND',
        'Yarbis Control commander channel is unavailable; no command was queued.',
      );
    }
    // UUID collision handling above prevents overwriting an existing record.
    return { ok: true, id };
  }

  function getCommand(id) {
    cleanupCommands();
    const record = commands.get(id);
    if (!record) return null;
    return {
      id: record.id,
      status: record.status,
      result: record.result,
      ...(record.stdout !== undefined
        ? {
            stdout: record.stdout,
            stderr: record.stderr,
            exit_code: record.exit_code,
            timeout: record.timeout,
          }
        : {}),
    };
  }

  function close() {
    generation += 1;
    connected = false;
    online = false;
    markPendingCommandsUncertain(
      'Delivery uncertain: the commander WebSocket was closed; the command was not retried.',
    );
    settleHandshake(
      upstreamError('DISCONNECTED', 'Yarbis Control commander channel closed.'),
    );
    const activeSocket = socket;
    socket = null;
    if (
      activeSocket &&
      activeSocket.readyState !== CLOSING &&
      activeSocket.readyState !== CLOSED &&
      typeof activeSocket.close === 'function'
    ) {
      try {
        activeSocket.close();
      } catch {
        // Closing is best effort and never reports upstream details.
      }
    }
  }

  return {
    status,
    getStatus: status,
    submitCommand,
    execute: submitCommand,
    getCommand,
    commandStatus: getCommand,
    close,
    targetNode: TARGET_NODE,
    constants: {
      targetNode: TARGET_NODE,
      commandMaxLength: COMMAND_MAX_LENGTH,
      commandTtlMs,
      commandMapMax,
    },
  };
}

function registerPc3Console(app, requirePwd, options = {}) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
    throw new TypeError('An Express app is required.');
  }
  if (typeof requirePwd !== 'function') {
    throw new TypeError('The existing requirePwd middleware is required.');
  }
  const adapter = options.adapter || createPc3ConsoleAdapter(options);
  const noStore = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };

  app.get('/api/pc3-console/status', requirePwd, noStore, async (_req, res) => {
    res.json(await adapter.status());
  });

  app.post(
    '/api/pc3-console/commands',
    requirePwd,
    async (req, res) => {
      const body = req.body;
      const command = body && typeof body === 'object' ? body.command : undefined;
      try {
        const accepted = await adapter.submitCommand(command);
        res.status(202).json(accepted);
      } catch (error) {
        const code = error instanceof Pc3ConsoleError ? error.code : 'UPSTREAM_ERROR';
        const message = safeErrorMessage(
          error,
          'Yarbis Control commander channel is unavailable; no command was queued.',
        );
        res.status(code === 'COMMAND_INVALID' ? 400 : 503).json({
          ok: false,
          error: message,
        });
      }
    },
  );

  app.get(
    '/api/pc3-console/commands/:id',
    requirePwd,
    noStore,
    (req, res) => {
      const command = adapter.getCommand(req.params.id);
      if (!command) {
        res.status(404).json({ error: 'Unknown PC-MIAMI command id.' });
        return;
      }
      res.json(command);
    },
  );

  return adapter;
}

module.exports = registerPc3Console;
module.exports.registerPc3Console = registerPc3Console;
module.exports.createPc3ConsoleAdapter = createPc3ConsoleAdapter;
module.exports.Pc3ConsoleError = Pc3ConsoleError;
module.exports.DEFAULT_YARBIS_CONTROL_URL = DEFAULT_YARBIS_CONTROL_URL;
module.exports.TARGET_NODE = TARGET_NODE;