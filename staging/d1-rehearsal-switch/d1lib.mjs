import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
export const ACCOUNT = '439cc74123631d21ff905817aca9785d';
export const DB_ID = 'ee40e329-39e2-47fa-b8d7-040aa1f006bf';
const FORBIDDEN = ['802379c7-97cf-4262-93b8-da81c5c3c07d', '7b027b93-c548-4ceb-bbe9-42c45264fc23'];
const realFetch = globalThis.fetch;
let token;
function getToken() {
  if (!token) {
    token = execFileSync('npx', ['-y', 'wrangler@4.149.0', 'auth', 'token'], { shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/).map(line => line.trim()).filter(line => /^[A-Za-z0-9_.-]{20,}$/.test(line)).pop();
  }
  return token;
}
export async function query(sql, params = []) {
  if (FORBIDDEN.includes(DB_ID) || !/^[0-9a-f-]{36}$/.test(DB_ID)) throw new Error('refusing: not the throwaway database');
  const response = await realFetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await response.json();
  if (!body.success || !body.result?.[0]?.success) throw new Error('D1: ' + (body.errors?.[0]?.message || 'query failed'));
  return body.result[0];
}
export async function dbName() {
  const r = await realFetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB_ID}`, { headers: { Authorization: 'Bearer ' + getToken() } });
  return (await r.json()).result?.name;
}
export const DB = {
  prepare(sql) {
    const make = args => ({
      async first() { return (await query(sql, args)).results[0] || null; },
      async run() { const r = await query(sql, args); return { meta: { changes: r.meta?.changes ?? 0 } }; },
      async all() { return { results: (await query(sql, args)).results }; },
    });
    return { bind: (...args) => make(args), ...make([]) };
  },
};
export async function snapshot() {
  const schema = (await query("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")).results;
  const counts = {};
  const hash = crypto.createHash('sha256');
  for (const row of schema.filter(r => /^CREATE TABLE/i.test(r.sql || ''))) {
    const rows = (await query('SELECT * FROM ' + row.name + ' ORDER BY 1')).results;
    counts[row.name] = rows.length;
    hash.update(row.name + JSON.stringify(rows));
  }
  return { schema: schema.map(r => r.name + ':' + crypto.createHash('sha256').update(r.sql || '').digest('hex').slice(0, 8)), counts, dataHash: hash.digest('hex').slice(0, 16) };
}
