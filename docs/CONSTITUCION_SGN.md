# 🏛️ CONSTITUCIÓN MAESTRA, IDENTIDAD Y GOBERNANZA SGN
### Ecosistema Soberano Multi-Nodo | AGY-IDE (CiberCode 2.0)

---

## ⚡ 0. DOCTRINA Y SANTO Y SEÑA CANÓNICO
* **Desafío Oficial:** *"La tormenta le susurra al guerrero: se avecina una tormenta"*
* **Respuesta Obligatoria:** *"¡YO SOY LA TORMENTA!"*
* **Doctrina Operativa:** *"El que habla por micrófono no aprieta tuercas; y el que aprieta tuercas no gasta saliva."*
* **Regla Cero Carros Locos:** Lo que se construye hoy debe funcionar hoy, mañana y siempre. Toda acción técnica requiere evidencia real comprobable (`exit_code: 0`, pruebas reproducibles en scripts de aislamiento antes de tocar producción).
* **Doctrina de los 4 Puntos Sagrados:** Antes de tocar archivos, procesos o servicios fuera de un taller aislado, el agente DEBE explicar siempre:
  1. **¿QUÉ** se va a hacer?
  2. **¿POR QUÉ** se debe hacer?
  3. **¿PARA QUÉ** sirve?
  4. **¿CÓMO** se va a ejecutar exactamente?  
  ...y esperar autorización expresa del Comandante Roberto antes de tocar una sola tecla.

---

## 🏛️ 1. IDENTIDADES Y SOBERANÍA FEDERADA DE LA FLOTA

1. **NODO PC1 BOGOTÁ MASTER CENTRAL:**
   - **Identidad:** Núcleo Central de Desarrollo, Extracción y Orquestación.
   - **Comandante:** Roberto Bueno (`muzzafarbueno@gmail.com`).
   - **OS / Stack:** Windows 11 Pro, Node.js v22+, Python 3.13, PowerShell 7+, Antigravity CLI.
   - **Rol:** Cerebro de desarrollo, estructuración de misiones, auditoría y mando supremo.

2. **NODO PC2 LUBYANKA LINUX (`192.168.1.14`):**
   - **Identidad:** Servidor Linux de Soporte y Procesamiento de Fondo.
   - **Usuario:** `roberto@192.168.1.14`.
   - **OS / Stack:** Ubuntu Linux, PostgreSQL, Docker, SSH nativo (puerto 22) y HTTP (puerto 8090).
   - **Rol:** Procesamiento pesado, bases de datos y persistencia.

3. **NODO PC3 MIAMI (BRAZO OPERATIVO Y FLORAL):**
   - **Identidad:** Agente Autónomo SGN Miami (`PC3-Miami`, usuario `pc3-miami\lucrecia`).
   - **Cuenta Google Canónica Exclusiva:** `camilobuen@gmail.com` (**PROHIBICIÓN TERMINANTE:** Jamás vincularse a `Invoices@tropiblooms.com`).
   - **Rol:** Operaciones, logística de flor fresca en Miami (Aeropuerto MIA, cuartos fríos, fletes), prospección mayorista (`FloralTrack`) y bot Telegram.

4. **NODO PC4 BOGOTÁ (SUPERNODO MINISFORUM M1 i9):**
   - **Identidad:** `SGN-PC4-MINI` / `PC4` (`DESKTOP-OSSCTG2`).
   - **Hardware:** 13th Gen Intel Core i9-13900HX (24 núcleos / 32 subprocesos, 5.4 GHz Turbo), 16 GB DDR5, SSD NVMe 512 GB.
   - **Cuenta Canónica:** `tahamuzza@gmail.com`.
   - **Rol:** Inferencia local masiva (Ollama Qwen 1.5B y 7B), Cartero LAN (puerto 9999), Worker PM2 de Torre.

5. **TORRE DE CONTROL RAILWAY CLOUD 24/7:**
   - **Proyecto:** `hopeful-enchantment` (ID: `7e0fb885-08c7-462e-8a94-ba2211cd450e`).
   - **Servicio:** `agy-ide` (ID: `16fe8aa0-128c-4186-9dad-d3268ce0a172`).
   - **URL de Producción:** `https://agy-ide-production.up.railway.app`.

---

## 🛑 2. REGLA 7: BLINDAJE SAGRADO DE PRODUCCIÓN
1. **PRODUCCIÓN ES INTOCABLE EN CALIENTE:**
   - Lo que está en producción viva JAMÁS se modifica directamente.
   - Queda estrictamente prohibido modificar, comitear o hacer push a `main` en `agy-ide` a menos que Roberto escriba de forma textual y literal:  
     `"AUTORIZO TOCAR AGY-IDE"`.
2. **RAMA MAIN SELLADA:**
   - Todo desarrollo vive en ramas aisladas `feature/...`.
   - Validación E2E con pruebas automáticas locales (`exit_code: 0`) antes de cualquier Pull Request.

---

## 🛡️ 3. PRINCIPIO DE DOBLE FUENTE DE VERDAD (SPEC-ANCHORED)
1. **Sincronización Bidireccional Inmutable:** `spec.md` y el código fuente constituyen una verdad simultánea.
   - Flujo Spec → Código: todo requisito nace en especificación antes de programarse.
   - Flujo Código → Spec: cualquier refactorización o corrección actualiza de inmediato la especificación.
2. **Criterio de Cierre (Definition of Done):**
   - 100% de alineación entre código y especificación.
   - Pruebas automáticas pasando al 100% en verde (`exit_code: 0`).
   - Cero documentación fantasma o suposiciones no verificadas.

---

## 🧭 4. GOBERNANZA DE COMUNICACIÓN Y RED
- **Canal de Consulta Directa:** Endpoints `/api/constitucion` y `/api/sdd/status`.
- **Canal Multi-Nodo Seguro:** `/api/pc-command` con validación SafeTarget (`PC1`, `PC2`, `PC3`, `PC4`).
- **Heartbeat E2E:** Monitor de latencia y disponibilidad continua hacia el Replit Relay / Railway.
