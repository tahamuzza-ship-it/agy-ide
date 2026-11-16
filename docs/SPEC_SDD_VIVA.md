# 📐 MATRIZ DE ESPECIFICACIÓN SDD VIVA (SPEC-DRIVEN DEVELOPMENT)
### AGY-IDE (CiberCode 2.0) | Módulo Gobernanza, SDD y Pruebas Didácticas

---

## 🎯 1. OBJETIVO DEL SISTEMA Y DOBLE FUENTE DE VERDAD
Garantizar la fusión inmutable entre la especificación y el código ejecutable de AGY-IDE bajo el principio de **Doble Fuente de Verdad (Spec-Anchored)**, proveyendo al operador y usuarios una cabecera equilibrada de 3 filas con modales interactivos para la Constitución SGN y una Consola Didáctica de Pruebas HTML en 1-clic.

---

## 📋 2. CONTRATOS DE ENDPOINTS (EARS NOTATION)

### RF-01: Consulta de Constitución SGN (`GET /api/constitucion`)
- **Gatillo:** Cuando un cliente solicita `GET /api/constitucion`.
- **Comportamiento:** El servidor retornará un objeto JSON con `ok: true`, los campos de doctrina (`santo_y_sena`, `regla_cero`, `cuatro_puntos_sagrados`, `regla_7`), la metadata de la flota multi-nodo y el texto completo en Markdown (`markdown`).
- **Código de Respuesta:** `200 OK` (o `500` ante error interno).

### RF-02: Estado de Sincronización SDD (`GET /api/sdd/status`)
- **Gatillo:** Cuando un cliente solicita `GET /api/sdd/status`.
- **Comportamiento:** El servidor retornará un objeto JSON con `ok: true`, `sdd_version`, `estado: "SINCRONIZADO"`, `doble_fuente_de_verdad: true`, la lista de módulos validados y el markdown de la especificación viva.
- **Código de Respuesta:** `200 OK`.

### RF-03: Comando Multi-Nodo (`POST /api/pc-command`)
- **Gatillo:** Cuando un operador autenticado envía un comando universal hacia un nodo (`PC1`, `PC2`, `PC4`).
- **Guardrail:** Solo se aceptan targets validados por la lista blanca `SafeTarget` (`PC1`, `PC2`, `PC4`). Cualquier target desconocido es rechazado con `400 Bad Request`.

### RF-04: Heartbeat E2E (`GET /api/heartbeat`)
- **Gatillo:** Cuando se consulta el pulso de vida del backend.
- **Comportamiento:** Retorna el estado del Replit Relay / Railway cloud con timestamp y latencia.

---

## 🎨 3. ESPECIFICACIÓN FRONTEND (CABECERA & MODALES)

### Fila 1: Control & Herramientas Locales (8 botones en HTML + 1 runtime)
- `btn-run`, `btn-goal`, `btn-clear-out`, `btn-clear-chat`, `btn-notebooklm`, `btn-comandos`, `btn-files`, `btn-chats`.

### Fila 2: Flota Multi-Nodo & Enlaces Globales (9 botones en HTML)
- `btn-puente-pc1`, `btn-puente-pc2`, `btn-console-pc3`, `btn-console-pc4`, `btn-mailbox`, `📖 MANUAL`, `▶ VIDEO MANUAL`, `🛰 CONSOLA YARBIS`, `💻 CIBERCODE`.

### Fila 3: Gobernanza, SDD Vivo & Pruebas Didácticas (4 botones en HTML, 100% ancho)
- Separador: `<div class="header-row-break" aria-hidden="true"></div>`.
- `btn-constitucion`: `🏛️ CONSTITUCIÓN SGN` (Abre modal `#constitucion-modal` en pestaña Constitución).
- `btn-sdd-matrix`: `📐 MATRIZ SDD VIVA` (Abre modal `#constitucion-modal` en pestaña SDD).
- `btn-pruebas-html`: `🧪 PRUEBAS DIDÁCTICAS HTML` (Abre modal `#pruebas-didacticas-modal`).
- `btn-salud-flota`: `📊 SALUD FLOTA` (Abre diagnóstico en `#pruebas-didacticas-modal`).

---

## 🧪 4. BATERÍA DE PRUEBAS AUTOMÁTICAS (TEST SUITE)
1. `test/header-rows.test.cjs`: Valida que existan exactamente 2 separadores `header-row-break` (3 filas), y verifica la cuenta exacta de botones por fila.
2. `test/pc4-terminal.test.cjs`: Valida integración y SafeTarget para PC4.
3. `test/constitucion-sdd.test.cjs`: Valida contrato de `/api/constitucion`, `/api/sdd/status`, presencia física de documentos en `docs/` y elementos en `index.html`.
