// Cloudflare Worker — amit-photos
// מטפל בנתיבי API ומגיש static assets

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,PATCH,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Password',
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
function unauth() { return jsonRes({ error: 'לא מורשה' }, 401); }
function checkAuth(request, env) {
  return request.headers.get('X-Admin-Password') === env.ADMIN_PASSWORD;
}

// ===== SUBSCRIBERS =====
async function handleSubscribers(request, env) {
  if (!checkAuth(request, env)) return unauth();
  const method = request.method;

  if (method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM subscribers ORDER BY created_at DESC'
    ).all();
    return jsonRes(results);
  }

  if (method === 'POST') {
    const { name, email, notes } = await request.json().catch(() => ({}));
    if (!email) return jsonRes({ error: 'מייל חסר' }, 400);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO subscribers (id, name, email, notes, created_at) VALUES (?,?,?,?,?)'
    ).bind(id, name || '', email, notes || '', new Date().toISOString()).run();
    return jsonRes({ ok: true, id });
  }

  if (method === 'DELETE') {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return jsonRes({ error: 'id חסר' }, 400);
    await env.DB.prepare('DELETE FROM subscribers WHERE id=?').bind(id).run();
    return jsonRes({ ok: true });
  }

  return jsonRes({ error: 'method not allowed' }, 405);
}

// ===== CUSTOMERS =====
async function handleCustomers(request, env) {
  if (!checkAuth(request, env)) return unauth();
  const method = request.method;

  if (method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM customers ORDER BY created_at DESC'
    ).all();
    return jsonRes(results);
  }

  if (method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { id, name, email, phone, date, type, status, subject, notes } = body;
    if (!name) return jsonRes({ error: 'שם חסר' }, 400);
    if (id) {
      await env.DB.prepare(
        `UPDATE customers SET name=?,email=?,phone=?,date=?,type=?,status=?,subject=?,notes=? WHERE id=?`
      ).bind(name, email||'', phone||'', date||'', type||'', status||'', subject||'', notes||'', id).run();
      return jsonRes({ ok: true, id });
    } else {
      const newId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO customers (id,name,email,phone,date,type,status,subject,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(newId, name, email||'', phone||'', date||'', type||'', status||'ממתין', subject||'', notes||'', new Date().toISOString()).run();
      return jsonRes({ ok: true, id: newId });
    }
  }

  if (method === 'DELETE') {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return jsonRes({ error: 'id חסר' }, 400);
    await env.DB.prepare('DELETE FROM customers WHERE id=?').bind(id).run();
    return jsonRes({ ok: true });
  }

  return jsonRes({ error: 'method not allowed' }, 405);
}

// ===== PHOTOS =====
async function handlePhotos(request, env) {
  if (!checkAuth(request, env)) return unauth();
  const method = request.method;

  if (method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM photos ORDER BY created_at DESC'
    ).all();
    return jsonRes(results);
  }

  if (method === 'PATCH') {
    const { id, title, category, description } = await request.json().catch(() => ({}));
    if (!id) return jsonRes({ error: 'id חסר' }, 400);
    await env.DB.prepare(
      'UPDATE photos SET title=?,category=?,description=? WHERE id=?'
    ).bind(title||'', category||'', description||'', id).run();
    return jsonRes({ ok: true });
  }

  if (method === 'DELETE') {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return jsonRes({ error: 'id חסר' }, 400);
    const row = await env.DB.prepare('SELECT r2_key FROM photos WHERE id=?').bind(id).first();
    if (row?.r2_key) await env.PHOTOS.delete(row.r2_key);
    await env.DB.prepare('DELETE FROM photos WHERE id=?').bind(id).run();
    return jsonRes({ ok: true });
  }

  return jsonRes({ error: 'method not allowed' }, 405);
}

// ===== UPLOAD =====
async function handleUpload(request, env) {
  if (!checkAuth(request, env)) return unauth();
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405);

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') return jsonRes({ error: 'קובץ חסר' }, 400);

  const ext = file.name.split('.').pop().toLowerCase();
  const id = crypto.randomUUID();
  const key = `${id}.${ext}`;

  await env.PHOTOS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'image/jpeg' },
  });

  const url = `/photos/${key}`;
  await env.DB.prepare(
    `INSERT INTO photos (id,title,category,description,filename,r2_key,url,thumbnail,created_at) VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    id,
    formData.get('title') || '',
    formData.get('category') || '',
    formData.get('description') || '',
    file.name, key, url, url,
    new Date().toISOString()
  ).run();

  return jsonRes({ ok: true, id, url, key });
}

// ===== TRIGGER GITHUB ACTIONS =====
async function handleTriggerWorkflow(request, env) {
  if (!checkAuth(request, env)) return unauth();
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405);

  if (!env.GITHUB_TOKEN) return jsonRes({ error: 'GITHUB_TOKEN לא מוגדר' }, 500);

  const body = await request.json().catch(() => ({}));
  const workflow = body.workflow || 'update-photos.yml';

  const res = await fetch(
    `https://api.github.com/repos/erezfamily-cmyk/amit-photos/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );

  if (res.status === 204) return jsonRes({ ok: true, message: 'הסקריפט הופעל בהצלחה' });
  const err = await res.text();
  return jsonRes({ error: `GitHub API: ${err}` }, res.status);
}

// ===== FILL TITLES WITH AI =====
function isGenericTitle(title) {
  if (!title) return true;
  return /^(IMG|DSC|DSCN|MJH|greece|P\d|PIC|photo|image)[_\-]?\S*$/i.test(title);
}

async function handleFillTitles(request, env) {
  if (!checkAuth(request, env)) return unauth();
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405);

  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: 'ANTHROPIC_API_KEY לא מוגדר' }, 500);

  const origin = new URL(request.url).origin;
  const { results: photos } = await env.DB.prepare(
    'SELECT id, title, category, r2_key FROM photos'
  ).all();

  const toFill = photos.filter(p => isGenericTitle(p.title));
  if (!toFill.length) return jsonRes({ updated: 0, message: 'כל הכותרות כבר מלאות' });

  const updated = [];
  for (const photo of toFill) {
    try {
      const imageUrl = `${origin}/photos/${photo.r2_key}`;
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 30,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'url', url: imageUrl } },
              { type: 'text', text: `זוהי תמונה מגלריית הצילום של הצלם עמית ארז, קטגוריה: ${photo.category || 'כללי'}.\nתן לתמונה כותרת קצרה ויפה בעברית — 2 עד 4 מילים בלבד.\nהחזר רק את הכותרת, ללא פיסוק נוסף.` }
            ]
          }]
        })
      });
      if (!res.ok) continue;
      const data = await res.json();
      const title = data.content?.[0]?.text?.trim().replace(/^['"]|['"]$/g, '');
      if (title) {
        await env.DB.prepare('UPDATE photos SET title=? WHERE id=?').bind(title, photo.id).run();
        updated.push({ id: photo.id, title });
      }
    } catch { /* המשך לתמונה הבאה */ }
  }

  return jsonRes({ updated: updated.length, total: toFill.length, titles: updated });
}

// ===== SERVE PHOTO FROM R2 =====
async function servePhoto(key, env) {
  const object = await env.PHOTOS.get(key);
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

// ===== MAIN ROUTER =====
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (path === '/api/subscribers') return handleSubscribers(request, env);
    if (path === '/api/customers')   return handleCustomers(request, env);
    if (path === '/api/photos')      return handlePhotos(request, env);
    if (path === '/api/upload')       return handleUpload(request, env);
    if (path === '/api/fill-titles')       return handleFillTitles(request, env);
    if (path === '/api/trigger-workflow')  return handleTriggerWorkflow(request, env);
    if (path.startsWith('/photos/'))  return servePhoto(path.slice('/photos/'.length), env);

    // Static assets
    return env.ASSETS.fetch(request);
  },
};
