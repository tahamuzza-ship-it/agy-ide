-- ══════════════════════════════════════════════════════════════
--  goal_sessions — tabla para el modo agente autónomo de AGY-IDE
--  Ejecutar en Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS goal_sessions (
  id          TEXT PRIMARY KEY,
  goal_text   TEXT NOT NULL,
  target      TEXT NOT NULL DEFAULT 'PC1',
  status      TEXT NOT NULL DEFAULT 'running',
    -- valores posibles: running | done | blocked | cancelled | error
  steps_done  INTEGER NOT NULL DEFAULT 0,
  max_steps   INTEGER NOT NULL DEFAULT 50,
  retries     INTEGER NOT NULL DEFAULT 0,
  log         JSONB NOT NULL DEFAULT '[]'::jsonb,
  result      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para buscar sesiones activas rápidamente
CREATE INDEX IF NOT EXISTS goal_sessions_status_idx
  ON goal_sessions (status, created_at DESC);

-- Habilitar RLS
ALTER TABLE goal_sessions ENABLE ROW LEVEL SECURITY;

-- Política: solo el service role puede leer/escribir
CREATE POLICY "service_role_only" ON goal_sessions
  USING (true)
  WITH CHECK (true);
