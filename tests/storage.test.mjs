import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresStore } from "../src/postgres-store.js";

function database() {
  const rows = new Map();
  return async (strings, ...values) => {
    const sql = strings.join("?").trim();
    if (sql.startsWith("CREATE") || sql.startsWith("ALTER")) return [];
    if (sql.startsWith("SELECT")) {
      const row = rows.get(values[0]); return row ? [{ state: structuredClone(row.state), version: String(row.revision) }] : [];
    }
    if (sql.startsWith("INSERT")) {
      const [key, payload] = values;
      if (rows.has(key)) return [];
      rows.set(key, { state: JSON.parse(payload), revision: 0 }); return [{ version: "0" }];
    }
    if (sql.startsWith("UPDATE")) {
      const [payload, key, version] = values, row = rows.get(key);
      if (!row || String(row.revision) !== version) return [];
      row.state = JSON.parse(payload); row.revision++;
      return [{ version: String(row.revision) }];
    }
    throw new Error("Unexpected SQL");
  };
}
test("database compare-and-swap rejects stale writes and preserves latest state", async () => {
  const query = database(), first = createPostgresStore("", "accounts", query), second = createPostgresStore("", "accounts", query);
  await first.load(); await first.save({ balance: 25 });
  await second.load(); await first.load();
  await first.save({ balance: 20 });
  await assert.rejects(second.save({ balance: 15 }), { code: "LEDGER_CONFLICT" });
  assert.deepEqual(await second.load(), { balance: 20 });
  await second.save({ balance: 17 });
  assert.deepEqual(await first.load(), { balance: 17 });
});
test("database initial inserts race safely and namespaces remain separate", async () => {
  const query = database(), first = createPostgresStore("", "accounts", query), second = createPostgresStore("", "accounts", query);
  await first.load(); await second.load(); await first.save({ owner: "alice" });
  await assert.rejects(second.save({ owner: "bob" }), { code: "LEDGER_CONFLICT" });
  const identity = createPostgresStore("", "identity", query);
  assert.equal(await identity.load(), null);
  await identity.save({ users: 2 });
  assert.deepEqual(await first.load(), { owner: "alice" });
});
