// Cloudflare Worker — amit-photos
// מטפל בנתיבי API ומגיש static assets

const ALLOWED_ORIGINS = ['https://amitphotos.com', 'https://www.amitphotos.com'];
const SESSION_TTL_HOURS = 8;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Session-Token',
    'Vary': 'Origin',
  };
}

function jsonRes(data, status = 200, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: request ? corsHeaders(request) : { 'Content-Type': 'application/json' }
  });
}
function unauth(request) { return jsonRes({ error: 'לא מורשה' }, 401, request); }

async function checkAuth(request, env) {
  const token = request.headers.get('X-Session-Token');
  if (!token) return false;
  const session = await env.DB.prepare(
    'SELECT token FROM sessions WHERE token=? AND expires_at > ?'
  ).bind(token, new Date().toISOString()).first();
  return !!session;
}

// ===== LOGIN =====
async function handleLogin(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = new Date();

  // בדוק brute force
  const attempt = await env.DB.prepare(
    'SELECT count, last_attempt FROM login_attempts WHERE ip=?'
  ).bind(ip).first();

  if (attempt) {
    const lastTime = new Date(attempt.last_attempt);
    const minutesPassed = (now - lastTime) / 1000 / 60;
    if (minutesPassed < LOCKOUT_MINUTES && attempt.count >= MAX_LOGIN_ATTEMPTS) {
      const remaining = Math.ceil(LOCKOUT_MINUTES - minutesPassed);
      return jsonRes({ error: `נחסמת. נסה שוב בעוד ${remaining} דקות.` }, 429, request);
    }
    if (minutesPassed >= LOCKOUT_MINUTES) {
      await env.DB.prepare('DELETE FROM login_attempts WHERE ip=?').bind(ip).run();
    }
  }

  const { password } = await request.json().catch(() => ({}));
  // בדוק סיסמה — קודם D1 (איפוס), אחר כך env
  const storedPwd = await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind('admin_password').first().catch(() => null);
  const correctPassword = storedPwd?.value || env.ADMIN_PASSWORD;
  if (!password || password !== correctPassword) {
    // רשום כישלון
    await env.DB.prepare(
      `INSERT INTO login_attempts (ip, count, last_attempt) VALUES (?,1,?)
       ON CONFLICT(ip) DO UPDATE SET count=count+1, last_attempt=excluded.last_attempt`
    ).bind(ip, now.toISOString()).run();
    return jsonRes({ error: 'סיסמה שגויה' }, 401, request);
  }

  // הצלחה — נקה כישלונות, צור session
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip=?').bind(ip).run();
  const token = crypto.randomUUID();
  const expires = new Date(now.getTime() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (token, created_at, expires_at) VALUES (?,?,?)'
  ).bind(token, now.toISOString(), expires).run();

  // נקה sessions ישנים
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now.toISOString()).run();

  return jsonRes({ ok: true, token }, 200, request);
}

// ===== RESET PASSWORD =====
async function handleResetPassword(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  const { reset_token, new_password } = await request.json().catch(() => ({}));
  if (!reset_token || !new_password) return jsonRes({ error: 'פרטים חסרים' }, 400, request);
  if (!env.RESET_TOKEN) return jsonRes({ error: 'RESET_TOKEN לא מוגדר בסביבה' }, 500, request);
  if (reset_token !== env.RESET_TOKEN) return jsonRes({ error: 'קוד איפוס שגוי' }, 401, request);
  if (new_password.length < 6) return jsonRes({ error: 'הסיסמה חייבת להכיל לפחות 6 תווים' }, 400, request);
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('admin_password', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).bind(new_password).run();
  // בטל את כל הסשנים הקיימים
  await env.DB.prepare('DELETE FROM sessions').run();
  return jsonRes({ ok: true }, 200, request);
}

async function handleLogout(request, env) {
  const token = request.headers.get('X-Session-Token');
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(token).run();
  return jsonRes({ ok: true }, 200, request);
}

// ===== SUBSCRIBERS =====
async function handleSubscribers(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
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
  if (!await checkAuth(request, env)) return unauth(request);
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
  if (!await checkAuth(request, env)) return unauth(request);
  const method = request.method;

  if (method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM photos ORDER BY created_at DESC'
    ).all();
    return jsonRes(results);
  }

  if (method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { id, title, category, description, filename, r2_key, url, thumbnail } = body;
    if (!url) return jsonRes({ error: 'url חסר' }, 400, request);
    const photoId = id || crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO photos (id,title,category,description,filename,r2_key,url,thumbnail,created_at) VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, category=excluded.category, description=excluded.description, url=excluded.url, thumbnail=excluded.thumbnail`
    ).bind(photoId, title||'', category||'', description||'', filename||'', r2_key||'', url, thumbnail||url, new Date().toISOString()).run();
    return jsonRes({ ok: true, id: photoId }, 200, request);
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
  if (!await checkAuth(request, env)) return unauth(request);
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
  if (!await checkAuth(request, env)) return unauth(request);
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
        'User-Agent': 'amit-photos-worker',
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
  // כל כותרת שאין בה אף תו עברי — גנרית
  return !/[\u05D0-\u05EA]/.test(title);
}

async function handleFillTitles(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
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

// ===== NEWSLETTER =====
async function handleNewsletter(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  if (!env.RESEND_API_KEY) return jsonRes({ error: 'RESEND_API_KEY לא מוגדר ב-Cloudflare' }, 500, request);

  const { subject, body } = await request.json().catch(() => ({}));
  if (!subject || !body) return jsonRes({ error: 'נושא ותוכן הם שדות חובה' }, 400, request);

  const { results: subscribers } = await env.DB.prepare('SELECT email, name FROM subscribers').all();
  if (!subscribers.length) return jsonRes({ error: 'אין נרשמים ברשימה' }, 400, request);

  const fromEmail = env.FROM_EMAIL || 'amit@amitphotos.com';
  const html = `<div dir="rtl" style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:2rem;color:#111">
    <h2 style="color:#c8a96e;font-family:sans-serif">AMIT PHOTOS</h2>
    <div style="line-height:1.8;white-space:pre-wrap">${body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
    <hr style="margin-top:2rem;border-color:#ddd">
    <p style="color:#999;font-size:.8rem">קיבלת מייל זה כי נרשמת לניוזלטר של עמית פוטוס.</p>
  </div>`;

  let sent = 0;
  for (const sub of subscribers) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to: sub.email, subject, html })
    });
    if (res.ok) sent++;
  }
  return jsonRes({ ok: true, sent, total: subscribers.length }, 200, request);
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
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (path === '/api/login')             return handleLogin(request, env);
    if (path === '/api/logout')            return handleLogout(request, env);
    if (path === '/api/reset-password')    return handleResetPassword(request, env);
    if (path === '/api/subscribers')       return handleSubscribers(request, env);
    if (path === '/api/customers')         return handleCustomers(request, env);
    if (path === '/api/photos')            return handlePhotos(request, env);
    if (path === '/api/upload')            return handleUpload(request, env);
    if (path === '/api/fill-titles')       return handleFillTitles(request, env);
    if (path === '/api/trigger-workflow')  return handleTriggerWorkflow(request, env);
    if (path === '/api/newsletter')        return handleNewsletter(request, env);
    if (path.startsWith('/photos/'))       return servePhoto(path.slice('/photos/'.length), env);

    // Static assets
    return env.ASSETS.fetch(request);
  },
};
