# Revisión aislada de autenticación de operadores AGY IDE

Parche **incremental solo para revisión**, basado en la revisión publicada `313f9945aa7be8611b68fe96351c4404172098ff`. No publicarlo ni ejecutar su SQL. **Según el propietario, el esquema SQL ya fue aplicado: no volver a ejecutar la migración ni el SQL de catálogo.** No se ha consultado Supabase para verificarlo. Solo se revisan los nombres y la comprobación de claves de los módulos de operadores; no se cambian Buzón, puente, Cartero, PC1, Yarbis, MCP ni el registro de rutas.

## Qué contiene

- `operator-auth.cjs` conserva la autoridad individual ya preparada. Únicamente el cliente de Supabase Auth usa `SUPABASE_PUBLISHABLE_KEY_2` para `signInWithPassword` y `getUser`; solo el cliente servidor de sesiones y permisos usa `SUPABASE_SECRET_KEY_2`. No hay reutilización de claves entre clientes ni lectura de variables heredadas.
- `operator-invitation.cjs` usa exclusivamente `SUPABASE_PUBLISHABLE_KEY_2`; jamás lee la Secret. `operator-invitation-page.cjs` y `server.js` permanecen idénticos.
- `operator-auth-migration.sql` y `operator-auth-catalog-review.sql` son referencias históricas para revisar, **no ejecutar ni repetir**: el propietario informa que el esquema ya existe. La concesión inicial de ejemplo es solo `memory.read`. El permiso de propuesta sigue condicionado a evidencia real y autorización independiente.
- `test/operator-auth.test.cjs`, `test/operator-fixture.cjs` y `test/operator-invitation.test.cjs` usan proveedores simulados, dominios `example.test`, archivos temporales y un VM que sustituye **solo en memoria** los bloqueos de prueba. No usan un proveedor real ni prueban el servicio Yarbis.

## Estado si se aplicase tal cual (NO autorizado)

`OPERATOR_AUTH_RELEASE_ENABLED = false`; en autenticación, `VERIFIED_PUBLISHABLE_KEY_2_SHA256 = null` y `VERIFIED_SECRET_KEY_2_SHA256 = null`; en invitaciones, su pin separado `VERIFIED_PUBLISHABLE_KEY_2_SHA256 = null`. Son constantes del código. Ninguna variable de entorno ni inyección de adaptadores activa la autenticación, y el receptor tampoco puede habilitarse sin huella verificada. No hay claves reales ni huellas en el parche. El prefijo `sb_publishable_` o `sb_secret_` comprueba **solo la sintaxis/tipo**: estas claves son opacas, no son JWT, no contienen `role`/`ref` verificables y no prueban por sí mismas procedencia de Supabase 2. Es imprescindible acreditar **independientemente** cada clave exacta y su huella SHA-256 para vincularla al origen permitido. Una huella entregada por variable o navegador no sirve; no existe fallback a nombres `ANON`/`SERVICE_ROLE` antiguos.

Referencia oficial sobre claves Publishable/Secret opacas, `apikey` gestionado por SDK y separación del access token de usuario en `Authorization`: https://supabase.com/docs/guides/api/api-keys. El SDK recibe cada clave como segundo argumento de `createClient` y gestiona `apikey`; el token de sesión del usuario se pasa a `getUser`/`setSession`. El código no sustituye manualmente `Authorization` por una clave de proyecto.

| Ruta | Resultado previsto con el parche sin activación |
| --- | --- |
| `GET /api/agy/operator/invitation` | `503`, comportamiento **preexistente**, receptor intacto |
| `POST /api/agy/operator/invitation` | `503`, comportamiento **preexistente**, receptor intacto |
| `GET /api/agy/operator/session` | `401` sin contraseña IDE; con ella `200` y `configured:false`, `authenticated:false`, `authorized:false`, sin contactar al proveedor |
| `POST /api/agy/operator/login` | `401` sin contraseña IDE; con ella `503` |
| `POST /api/agy/operator/logout` | `401` sin contraseña IDE; con ella `503` |
| `/api/agy/yarbis-mcp/*` | **No se añaden**. No hay conexión MCP, canal de misiones ni interfaz de operador en este parche. |

Para una activación futura haría falta otra revisión y autorización: comprobar el origen exacto `https://agy-ide-production.up.railway.app`, acreditar **por separado** Publishable y Secret del proyecto Supabase 2 y pinchar cada huella SHA-256, verificar por cauce autorizado la compatibilidad del esquema existente **sin repetir su migración**, validar políticas reales del proveedor, conectar de forma auditada las capacidades, y solo después considerar cambiar el bloqueo compilado. Esta entrega **no** satisface ni ejecuta esos pasos. No basta con establecer `AGY_OPERATOR_AUTH_ENABLED=true`.

Prueba de revisión sin servicios externos (desde la raíz de AGY IDE, con dependencias `express` ya instaladas): `node --test test/operator-auth.test.cjs test/operator-invitation.test.cjs`. Ninguna prueba realiza requests a Supabase real; solo usa servidores locales efímeros. El resultado no demuestra autenticación real ni ausencia de escrituras de misiones reales.