// Cloudflare Pages Function — ניהול נרשמים
// GET    /api/subscribers        — רשימה
// POST   /api/subscribers        — הוספה
// DELETE /api/subscribers?id=... — מחיקה

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Password',
};

function unauthorized() {
  return new Response(JSON.stringify({ error: 'לא מורשה' }), { status: 401, headers });
}

function checkAuth(request, env) {
  const pwd = request.headers.get('X-Admin-Password');
  return pwd && pwd === env.ADMIN_PASSWORD;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers });
}

export async function onRequestGet({ request, env }) {
  if (!checkAuth(request, env)) return unauthorized();
  const { results } = await env.DB.prepare(
    'SELECT * FROM subscribers ORDER BY created_at DESC'
  ).all();
  return new Response(JSON.stringify(results), { headers });
}

export async function onRequestPost({ request, env }) {
  if (!checkAuth(request, env)) return unauthorized();
  const { name, email, notes } = await request.json().catch(() => ({}));
  if (!email) return new Response(JSON.stringify({ error: 'מייל חסר' }), { status: 400, headers });
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO subscribers (id, name, email, notes, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, name || '', email, notes || '', new Date().toISOString()).run();
  return new Response(JSON.stringify({ ok: true, id }), { headers });
}

export async function onRequestDelete({ request, env }) {
  if (!checkAuth(request, env)) return unauthorized();
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'id חסר' }), { status: 400, headers });
  await env.DB.prepare('DELETE FROM subscribers WHERE id = ?').bind(id).run();
  return new Response(JSON.stringify({ ok: true }), { headers });
}
