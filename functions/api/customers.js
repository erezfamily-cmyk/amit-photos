// Cloudflare Pages Function — ניהול לקוחות ופניות
// GET    /api/customers        — רשימה
// POST   /api/customers        — הוספה / עדכון (אם יש id בגוף)
// DELETE /api/customers?id=... — מחיקה

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
    'SELECT * FROM customers ORDER BY created_at DESC'
  ).all();
  return new Response(JSON.stringify(results), { headers });
}

export async function onRequestPost({ request, env }) {
  if (!checkAuth(request, env)) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const { id, name, email, phone, date, type, status, subject, notes } = body;

  if (!name) return new Response(JSON.stringify({ error: 'שם חסר' }), { status: 400, headers });

  if (id) {
    // עדכון קיים
    await env.DB.prepare(
      `UPDATE customers SET name=?, email=?, phone=?, date=?, type=?, status=?, subject=?, notes=?
       WHERE id=?`
    ).bind(name, email||'', phone||'', date||'', type||'', status||'', subject||'', notes||'', id).run();
    return new Response(JSON.stringify({ ok: true, id }), { headers });
  } else {
    // הוספה חדשה
    const newId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO customers (id, name, email, phone, date, type, status, subject, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(newId, name, email||'', phone||'', date||'', type||'', status||'ממתין', subject||'', notes||'', new Date().toISOString()).run();
    return new Response(JSON.stringify({ ok: true, id: newId }), { headers });
  }
}

export async function onRequestDelete({ request, env }) {
  if (!checkAuth(request, env)) return unauthorized();
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'id חסר' }), { status: 400, headers });
  await env.DB.prepare('DELETE FROM customers WHERE id = ?').bind(id).run();
  return new Response(JSON.stringify({ ok: true }), { headers });
}
