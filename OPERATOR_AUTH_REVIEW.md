# Revisión aislada de autenticación de operadores AGY IDE

Parche **solo para revisión**, basado en el commit publicado `a8c72be0aef1a4410e8e298aa7f27ce7fc87f5b3`. No publicarlo ni ejecutar su SQL. **Según el propietario, el esquema SQL ya fue aplicado: no volver a ejecutar la migración ni el SQL de catálogo.** No se ha consultado Supabase para verificarlo. El parche no incluye cambios en Buzón, puente, Cartero, PC1 ni servicio Yarbis; tampoco añade MCP/UI, envía invitaciones o crea usuarios.

## Qué contiene

- `server.js` registra exclusivamente login, logout y consulta de sesión, detrás de la contraseña IDE heredada. `requirePwd` es una declaración de función (hoisted) y está disponible al registrar las rutas. El registro existente del receptor de invitaciones queda intacto.
- `operator-auth.cjs` adapta la autoridad de operadores ya ensayada localmente: autenticación individual Supabase Auth (cliente de **clave pública**), consulta de permisos y sesiones con cliente servidor separado, cookies seguras, identidad verificada en línea, permisos comprobados sin caché, CSRF, vencimiento, revocación y límite de intentos. La función de verificación de scopes **no está conectada** a ninguna ruta MCP.
- `operator-auth-migration.sql` y `operator-auth-catalog-review.sql` son referencias históricas para revisar, **no ejecutar ni repetir**: el propietario informa que el esquema ya existe. La concesión inicial de ejemplo es solo `memory.read`. El permiso de propuesta sigue condicionado a evidencia real y autorización independiente.
- `test/operator-auth.test.cjs`, `test/operator-fixture.cjs` y `test/operator-invitation.test.cjs` usan proveedores simulados, dominios `example.test`, archivos temporales y un VM que sustituye **solo en memoria** los bloqueos de prueba. No usan un proveedor real ni prueban el servicio Yarbis.

## Estado si se aplicase tal cual (NO autorizado)

`OPERATOR_AUTH_RELEASE_ENABLED = false`, `VERIFIED_AUTH_ANON_KEY_SHA256 = null` y `VERIFIED_SERVICE_ROLE_KEY_2_SHA256 = null` son constantes del código; ninguna variable de entorno ni inyección de adaptadores puede activarlo. Ninguna clave ni su huella consta en el parche. No se cargará el SDK Supabase ni se leerá la clave privilegiada para la nueva autoridad. El adaptador, si se revisase separadamente para su activación en el futuro, **solo** considera `SUPABASE_SERVICE_ROLE_KEY_2` y exige comprobación conjunta de JWT `role=service_role`, `ref` de Supabase 2 y huella SHA-256 acreditada **independientemente**; decodificar el JWT por sí solo no prueba procedencia. Jamás lee ni reutiliza `SUPABASE_SERVICE_ROLE_KEY` heredada. El receptor existente conserva por separado `VERIFIED_ANON_KEY_SHA256 = null`.

| Ruta | Resultado previsto con el parche sin activación |
| --- | --- |
| `GET /api/agy/operator/invitation` | `503`, comportamiento **preexistente**, receptor intacto |
| `POST /api/agy/operator/invitation` | `503`, comportamiento **preexistente**, receptor intacto |
| `GET /api/agy/operator/session` | `401` sin contraseña IDE; con ella `200` y `configured:false`, `authenticated:false`, `authorized:false`, sin contactar al proveedor |
| `POST /api/agy/operator/login` | `401` sin contraseña IDE; con ella `503` |
| `POST /api/agy/operator/logout` | `401` sin contraseña IDE; con ella `503` |
| `/api/agy/yarbis-mcp/*` | **No se añaden**. No hay conexión MCP, canal de misiones ni interfaz de operador en este parche. |

Para una activación futura haría falta otra revisión y autorización: comprobar el origen exacto `https://agy-ide-production.up.railway.app`, acreditar **por separado** ambas claves del proyecto Supabase 2 y pinchar cada huella SHA-256, verificar por cauce autorizado la compatibilidad del esquema existente **sin repetir su migración**, validar políticas reales del proveedor, conectar de forma auditada las capacidades, y solo después considerar cambiar el bloqueo compilado. Esta entrega **no** satisface ni ejecuta esos pasos. No basta con establecer `AGY_OPERATOR_AUTH_ENABLED=true`.

Prueba de revisión sin servicios externos (desde la raíz de AGY IDE, con dependencias `express` ya instaladas): `node --test test/operator-auth.test.cjs test/operator-invitation.test.cjs`. Ninguna prueba realiza requests a Supabase real; solo usa servidores locales efímeros. El resultado no demuestra autenticación real ni ausencia de escrituras de misiones reales.