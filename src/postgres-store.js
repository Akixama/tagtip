import { neon } from "@neondatabase/serverless";

export function createPostgresStore(connectionString, key = "demo", query = neon(connectionString)) {
  const sql = query;
  let initialized = false;
  let version = null;

  async function ensureTable() {
    if (initialized) return;
    await sql`
      CREATE TABLE IF NOT EXISTS tagtip_state (
        id text PRIMARY KEY,
        state jsonb NOT NULL,
        revision bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`ALTER TABLE tagtip_state ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0`;
    initialized = true;
  }

  return {
    async load() {
      await ensureTable();
      const rows = await sql`SELECT state, revision::text AS version FROM tagtip_state WHERE id = ${key} LIMIT 1`;
      version = rows[0]?.version || null;
      return rows[0]?.state || null;
    },
    async save(value) {
      await ensureTable();
      const payload = JSON.stringify(value);
      const rows = version ? await sql`
        UPDATE tagtip_state SET state = ${payload}::jsonb, updated_at = clock_timestamp(), revision = revision + 1
        WHERE id = ${key} AND revision = ${version}::bigint
        RETURNING revision::text AS version
      ` : await sql`
        INSERT INTO tagtip_state (id, state, updated_at)
        VALUES (${key}, ${payload}::jsonb, now())
        ON CONFLICT (id) DO NOTHING
        RETURNING revision::text AS version
      `;
      if (!rows.length) {
        const error = new Error("The ledger changed during this request. Please retry.");
        error.code = "LEDGER_CONFLICT";
        throw error;
      }
      version = rows[0].version;
    },
  };
}
