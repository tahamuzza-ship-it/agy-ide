# MAPA DE CONSULTA RÁPIDA — SGN / TAHASISTEM PRO
_Tarjeta de bolsillo del Director: A DÓNDE consultar, CÓMO y PARA QUÉ. Va junto al guion en la carpeta Master Prompt. El detalle completo está en `MANUAL_ECOSISTEMA_SGN.md`. Última revisión: 2026-08-15._

---

## 1. ENLACES — a dónde entrar y para qué
| Enlace | Qué es | Para qué lo uso |
|---|---|---|
| `https://agy-ide-production.up.railway.app` | **AGY IDE** (Railway) | Panel MIS EQUIPOS (pantallas PC1/PC2 en vivo), botón 📋 COMANDOS, voz de AGY. La "sala de control" de la película. |
| `https://automate-make.replit.app` | **Puente MetaAgente** | Mandar comandos y misiones a PC1/PC2, ver la cola, heartbeats. |
| `https://cibercode-ide-production.up.railway.app` | **CIBERCODE** | El otro IDE; auditorías del plan. |
| `http://100.113.7.92:7681` | Terminal web de PC1 (GoTTY, vía Tailscale) | Ver/usar la terminal de PC1 en el navegador. |
| `100.121.53.89` (Tailscale) / `192.168.1.14` (local) | IP de PC2 | SSH y tmux compartido (plan B de control). |

## 2. BOTS DE TELEGRAM — a quién hablarle y para qué
| Bot | Para qué |
|---|---|
| `@Muzzapresentaciones_bot` | Canal PRIVADO de Roberto (Lead Architect). Avisos importantes y resultados finales. |
| `@Codearquitect_bot` | Comandos del ecosistema (CIBERCODE + AGY IDE). Por aquí entran órdenes. |
| Bot Tahamza (memoria) | Registra y recuerda lo que hace el ecosistema (pendiente de integrar — no depender de él aún). |

## 3. WORKERS / AYUDANTES — quién ejecuta qué
| Ayudante | Dónde vive | Qué hace |
|---|---|---|
| `ag-listener` de PC1 | Windows, arranque automático | Recoge comandos `[PC1]` del puente cada pocos segundos y los ejecuta. |
| `ag-listener` de PC2 | Linux, arranque automático | Igual para `[PC2]`. Al terminar misiones avisa por Telegram. |
| Ojo de PC1 (`pc1-eye.ps1` + `pc1-term-live.ps1` + guardián VBS) | Windows | Manda pantalla y terminal de PC1 al panel cada ~12 s. El guardián los revive si los matan. |
| Ojo de PC2 (captura + reporte) | Linux | Manda pantalla y terminal de PC2 al panel. |
| **Antigravity** | PC2 | La IA que trabaja EN PRIMER PLANO: cursor, navegador, edición. El actor principal. |
| **OpenCode** | PC2 | IA suplente de terminal cuando Antigravity agota cuota. |
| ⚠️ Auto-update | ambos PCs | Los listeners se re-descargan del puente cada 5 min: NUNCA parchar el listener a mano; los cambios van al template del puente. |

## 4. RUTAS Y COMANDOS CLAVE
- **PC1 — ruta oficial ÚNICA:** `C:\Users\Roberto1\OneDrive\Desktop` (PROHIBIDO "Documentos"). La carpeta **Master Prompt** está ahí.
- **PC2 — usuario:** `roberto`. Logs del listener: `~/ag-listener.log`.
- **Mandar comando a un PC:** `POST {puente}/api/antigravity/send` con `{"instruction":"[PC2] EJECUTAR <cmd>","target":"PC2","confirmed":true}` → sondear `GET /api/antigravity/status/<id>`.
- **Comandos que entienden los listeners:** `EJECUTAR` (shell sin gastar IA), `LISTAR`, `LEER`, `ABRIR` (solo PC1), `STATUS`, `AGY <prompt>` (gasta cuota — solo cuando toca pensar).
- **Riesgo:** comandos peligrosos (borrar, formatear, matar) requieren `confirmed:true`; los `/goal` usan `dispatch_token` del servidor.
- **Cámara de PC2:** comando guardado en AGY IDE → 📋 COMANDOS → "📷 Cámara de PC2" (prender y apagar).
- **Panel de comandos completo:** botón 📋 COMANDOS en AGY IDE — diagnóstico, SSH, estado del ecosistema, PowerShell de PC1.

## 5. MEMORIA COMPARTIDA (Supabase)
| Tabla | Qué guarda |
|---|---|
| `antigravity_commands` | Comandos directos y sus resultados. |
| `misiones` | Tareas con IA (quién, estado, resultado). |
| `agent_heartbeats` | Última señal de vida de cada PC (alerta si >10 min sin aparecer). |
| `goal_sessions` | Misiones autónomas `/goal` multi-paso. |

## 6. REGLAS QUE NUNCA SE ROMPEN
1. Toda ruta/endpoint se consulta AQUÍ o en el manual — nunca de memoria.
2. Nada destructivo sin aprobación explícita del Arquitecto (Roberto).
3. Pre-avisar antes de automatizar teclado/ratón.
4. Para lo mecánico, `EJECUTAR`; la cuota de IA se cuida.
5. Explicar en humano, sin jerga.
