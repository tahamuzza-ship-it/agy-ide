'use strict';
const { SCOPES, LIMITS, exact, fail } = require('./policy.cjs');
const definitions = [
  {
    name: 'agy_leer_capacidades',
    description: 'Catálogo local autorizado de AGY. No comprueba equipos ni crea misiones.',
    scope: SCOPES[0],
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
      type: 'object', additionalProperties: false,
      required: ['contract_version', 'phase', 'tools', 'generated_at'],
      properties: {
        contract_version: { type: 'string' }, phase: { const: 1 },
        generated_at: { type: 'string', format: 'date-time' },
        tools: { type: 'array', maxItems: 2, items: {
          type: 'object', additionalProperties: false, required: ['name', 'description', 'availability', 'limits'],
          properties: {
            name: { enum: ['agy_leer_capacidades', 'agy_obtener_ayuda'] },
            description: { type: 'string' }, availability: { const: 'disponible' },
            limits: { type: 'object', additionalProperties: false,
              properties: { response_bytes: { const: LIMITS.responseBytes } }, required: ['response_bytes'] },
          },
        } },
      },
    },
  },
  {
    name: 'agy_obtener_ayuda',
    description: 'Ayuda estática del perfil AGY; sin manuales internos ni acciones Make.',
    scope: SCOPES[1],
    inputSchema: { type: 'object', additionalProperties: false, required: ['tema'],
      properties: { tema: { enum: ['general', 'agy_leer_capacidades', 'agy_obtener_ayuda'] } } },
    outputSchema: {
      type: 'object', additionalProperties: false,
      required: ['tema', 'documentation_version', 'description', 'arguments', 'examples', 'limits', 'errors'],
      properties: {
        tema: { type: 'string' }, documentation_version: { type: 'string' }, description: { type: 'string' },
        arguments: { type: 'string' }, examples: { type: 'array', items: { type: 'string' } },
        limits: { type: 'array', items: { type: 'string' } },
        errors: { type: 'array', items: { type: 'string' } },
      },
    },
  },
];
function visible(scopes) { return definitions.filter(tool => scopes.includes(tool.scope)); }
function tools(scopes) {
  return visible(scopes).map(({ scope, ...tool }) => ({
    ...tool, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }));
}
function run(name, args, scopes) {
  if (['agy_consultar_estado', 'agy_obtener_resultado'].includes(name)) fail(403, 'FASE_2_BLOQUEADA');
  const tool = definitions.find(t => t.name === name);
  if (!tool) fail(400, 'HERRAMIENTA_DESCONOCIDA');
  if (!scopes.includes(tool.scope)) fail(403, 'PERMISO_INSUFICIENTE');
  if (name === 'agy_leer_capacidades') {
    exact(args, []);
    return {
      contract_version: 'agy-phase1-review-1', phase: 1, generated_at: new Date().toISOString(),
      tools: visible(scopes).map(t => ({
        name: t.name, description: t.description, availability: 'disponible',
        limits: { response_bytes: LIMITS.responseBytes },
      })),
    };
  }
  exact(args, ['tema']);
  if (args.tema !== 'general' && !visible(scopes).some(t => t.name === args.tema)) fail(400, 'TEMA_NO_DISPONIBLE');
  return {
    tema: args.tema, documentation_version: 'agy-phase1-review-1',
    description: args.tema === 'general'
      ? 'Yarbis consume únicamente capacidades y ayuda de AGY. Fase 2 bloqueada.'
      : definitions.find(t => t.name === args.tema).description,
    arguments: args.tema === 'agy_leer_capacidades' ? 'Objeto vacío.' : 'tema: general o una herramienta autorizada.',
    examples: ['Ejemplo ficticio: agy_obtener_ayuda con {"tema":"general"}.'],
    limits: ['Sin acceso a PC1 ni al puente.', 'Sin operaciones Make.', 'Sin misiones ni consultas de resultados.'],
    errors: ['PERMISO_INSUFICIENTE', 'AUTORIDAD_NO_DISPONIBLE', 'FASE_2_BLOQUEADA'],
  };
}
module.exports = { tools, run };