import { Pool } from 'pg'
import { env } from './env'
import { createModuleLogger } from '../logger/logger'

const log = createModuleLogger('postgres')

export const db = new Pool({
  host: env.postgres.host,
  port: env.postgres.port,
  database: env.postgres.database,
  user: env.postgres.user,
  password: env.postgres.password,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
})

const MIGRATION = `
  CREATE TABLE IF NOT EXISTS entities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    dev_id      TEXT NOT NULL,
    kind        TEXT NOT NULL,
    signature   TEXT NOT NULL,
    body        TEXT,
    file        TEXT NOT NULL,
    line        INT,
    created_at  TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS entity_changes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_name   TEXT NOT NULL,
    dev_id        TEXT NOT NULL,
    old_signature TEXT,
    new_signature TEXT NOT NULL,
    severity      TEXT NOT NULL,
    changed_at    TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS conflicts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_name  TEXT NOT NULL,
    dev_a_id     TEXT NOT NULL,
    dev_b_id     TEXT,
    description  TEXT NOT NULL,
    severity     TEXT NOT NULL,
    impact_count INT DEFAULT 0,
    detected_at  TIMESTAMPTZ DEFAULT now(),
    resolved     BOOLEAN DEFAULT false
  );

  ALTER TABLE entity_changes ADD COLUMN IF NOT EXISTS kind TEXT;
  ALTER TABLE entity_changes ADD COLUMN IF NOT EXISTS body TEXT;
  ALTER TABLE entity_changes ADD COLUMN IF NOT EXISTS file TEXT;
  ALTER TABLE entity_changes ADD COLUMN IF NOT EXISTS line INT;

  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS conflict_type       TEXT DEFAULT 'signature_drift';
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS blast_radius        INT  DEFAULT 0;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS security_sensitive  BOOLEAN DEFAULT false;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS conflict_session_id UUID;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS dev_a_body          TEXT;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS dev_b_body          TEXT;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS merged_body         TEXT;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS merged_sig          TEXT;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS resolution_type     TEXT;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS resolved_by         TEXT;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS resolved_at         TIMESTAMPTZ;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS triggering_change_id UUID;

  CREATE TABLE IF NOT EXISTS stale_writes (
    id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    dev_id              TEXT    NOT NULL,
    entity_name         TEXT    NOT NULL,
    conflict_session_id UUID,
    written_at          TIMESTAMPTZ DEFAULT now(),
    conflict_type       TEXT    NOT NULL
  );
`

export async function connectPostgres(): Promise<void> {
  await db.query('SELECT 1')
  log.info('PostgreSQL connected')
  await db.query(MIGRATION)
  log.info('Migrations applied')
}
