import { neon } from "@neondatabase/serverless";

export function createPostgresStore(connectionString) {
  const sql = neon(connectionString);
  let initialized = false;
  let version = null;

  async function ensureTable() {
    if (initialized) return;
    await sql`
      CREATE TABLE IF NOT EXISTS tagtip_state (
        id text PRIMARY KEY,
        state jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    initialized = true;
  }

  return {
    async load() {
      await ensureTable();
      const rows = await sql`SELECT state, updated_at::text AS version FROM tagtip_state WHERE id = 'demo' LIMIT 1`;
      version = rows[0]?.version || null;
      return rows[0]?.state || null;
    },
    async save(value) {
      await ensureTable();
      const payload = JSON.stringify(value);
      const rows = version ? await sql`
        UPDATE tagtip_state SET state = ${payload}::jsonb, updated_at = clock_timestamp()
        WHERE id = 'demo' AND updated_at = ${version}::timestamptz
        RETURNING updated_at::text AS version
      ` : await sql`
        INSERT INTO tagtip_state (id, state, updated_at)
        VALUES ('demo', ${payload}::jsonb, now())
        ON CONFLICT (id) DO NOTHING
        RETURNING updated_at::text AS version
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
