// GET    /api/photos        — רשימת תמונות מ-D1
// DELETE /api/photos?id=... — מחיקת תמונה מ-D1 + R2

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'X-Admin-Password',
};

function unauthorized() {
  return new Response(JSON.stringify({ error: 'לא מורשה' }), { status: 401, headers: HEADERS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: HEADERS });
}

export async function onRequestGet({ request, env }) {
  // ציבורי — הגלריה הציבורית קוראת endpoint זה ללא אימות
  const url = new URL(request.url);
  const adminMode = request.headers.get('X-Admin-Password') === env.ADMIN_PASSWORD;

  // אדמין מקבל את כל העמודות; ציבור מקבל שדות ציבוריים בלבד
  const query = adminMode
    ? 'SELECT * FROM photos ORDER BY created_at DESC'
    : 'SELECT id, title, category, parent_category, url, thumbnail, description, width, height, exif FROM photos ORDER BY created_at DESC';

  const { results } = await env.DB.prepare(query).all();
  return new Response(JSON.stringify(results), { headers: HEADERS });
}

export async function onRequestDelete({ request, env }) {
  const pwd = request.headers.get('X-Admin-Password');
  if (!pwd || pwd !== env.ADMIN_PASSWORD) return unauthorized();

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'id חסר' }), { status: 400, headers: HEADERS });

  // שלוף את ה-key מ-R2 לפני מחיקה
  const row = await env.DB.prepare('SELECT r2_key FROM photos WHERE id = ?').bind(id).first();
  if (row?.r2_key) {
    await env.PHOTOS.delete(row.r2_key);
  }

  await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
  return new Response(JSON.stringify({ ok: true }), { headers: HEADERS });
}
