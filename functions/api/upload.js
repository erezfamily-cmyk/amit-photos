// POST /api/upload
// multipart/form-data: file, title, category, description

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'X-Admin-Password',
};

function unauthorized() {
  return new Response(JSON.stringify({ error: 'לא מורשה' }), { status: 401, headers: HEADERS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: HEADERS });
}

export async function onRequestPost({ request, env }) {
  const pwd = request.headers.get('X-Admin-Password');
  if (!pwd || pwd !== env.ADMIN_PASSWORD) return unauthorized();

  const formData = await request.formData();
  const file = formData.get('file');
  const title = formData.get('title') || '';
  const category = formData.get('category') || '';
  const description = formData.get('description') || '';

  if (!file || typeof file === 'string') {
    return new Response(JSON.stringify({ error: 'קובץ חסר' }), { status: 400, headers: HEADERS });
  }

  const ext = file.name.split('.').pop().toLowerCase();
  const id = crypto.randomUUID();
  const key = `${id}.${ext}`;

  // העלה ל-R2
  await env.PHOTOS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'image/jpeg' },
    customMetadata: { title, category, description, originalName: file.name },
  });

  const url = `/photos/${key}`;
  const now = new Date().toISOString();

  // שמור מטא-דאטה ב-D1
  await env.DB.prepare(
    `INSERT INTO photos (id, title, category, description, filename, r2_key, url, thumbnail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, title, category, description, file.name, key, url, url, now).run();

  return new Response(JSON.stringify({ ok: true, id, url, key }), { headers: HEADERS });
}
