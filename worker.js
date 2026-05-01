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
  // Session token (כניסה רגילה לאדמין)
  const token = request.headers.get('X-Session-Token');
  if (token) {
    const session = await env.DB.prepare(
      'SELECT token FROM sessions WHERE token=? AND expires_at > ?'
    ).bind(token, new Date().toISOString()).first();
    return !!session;
  }
  // Admin password (לסקריפטים אוטומטיים כמו מיגרציה)
  const pwd = request.headers.get('X-Admin-Password');
  if (pwd && env.ADMIN_PASSWORD && pwd === env.ADMIN_PASSWORD) return true;
  return false;
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

// ===== FORGOT PASSWORD — שלח מייל עם קישור =====
async function handleForgotPassword(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  if (!env.RESEND_API_KEY) return jsonRes({ error: 'RESEND_API_KEY לא מוגדר' }, 500, request);

  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 דקות
  await env.DB.prepare(
    `INSERT INTO reset_tokens (token, expires_at) VALUES (?,?)
     ON CONFLICT(token) DO UPDATE SET expires_at=excluded.expires_at`
  ).bind(token, expires).run();
  // נקה טוקנים ישנים
  await env.DB.prepare('DELETE FROM reset_tokens WHERE expires_at < ?').bind(new Date().toISOString()).run();

  const origin = new URL(request.url).origin;
  const resetUrl = `${origin}/admin.html?reset=${token}`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Amit Photos <onboarding@resend.dev>',
      to: ['erez.family@gmail.com'],
      subject: 'איפוס סיסמה — Amit Photos',
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#c8a96e">Amit Photos — איפוס סיסמה</h2>
        <p>קיבלנו בקשה לאיפוס הסיסמה שלך.</p>
        <p>לחץ על הכפתור להגדרת סיסמה חדשה. הקישור תקף ל-30 דקות.</p>
        <a href="${resetUrl}" style="display:inline-block;margin:1.5rem 0;padding:.75rem 2rem;background:#c8a96e;color:#0a0a0a;text-decoration:none;border-radius:4px;font-weight:bold">אפס סיסמה</a>
        <p style="color:#888;font-size:.85rem">אם לא ביקשת איפוס, התעלם ממייל זה.</p>
      </div>`
    })
  });

  return jsonRes({ ok: true }, 200, request);
}

// ===== RESET PASSWORD — אימות טוקן + עדכון סיסמה =====
async function handleResetPassword(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  const { token, new_password } = await request.json().catch(() => ({}));
  if (!token || !new_password) return jsonRes({ error: 'פרטים חסרים' }, 400, request);
  if (new_password.length < 6) return jsonRes({ error: 'הסיסמה חייבת להכיל לפחות 6 תווים' }, 400, request);

  const row = await env.DB.prepare(
    'SELECT token FROM reset_tokens WHERE token=? AND expires_at > ?'
  ).bind(token, new Date().toISOString()).first().catch(() => null);
  if (!row) return jsonRes({ error: 'הקישור פג תוקף או אינו תקין' }, 401, request);

  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('admin_password', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).bind(new_password).run();
  await env.DB.prepare('DELETE FROM reset_tokens WHERE token=?').bind(token).run();
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
  const method = request.method;

  // POST פתוח לציבור — הרשמה לניוזלטר מהאתר
  if (method === 'POST') {
    const { name, email, notes } = await request.json().catch(() => ({}));
    if (!email) return jsonRes({ error: 'מייל חסר' }, 400, request);
    const existing = await env.DB.prepare('SELECT id FROM subscribers WHERE email = ?').bind(email).first();
    if (existing) return jsonRes({ ok: true, already: true }, 200, request);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO subscribers (id, name, email, notes, created_at) VALUES (?,?,?,?,?)'
    ).bind(id, name || '', email, notes || '', new Date().toISOString()).run();

    // שלח מייל אישור לנרשם
    if (env.RESEND_API_KEY) {
      const fromEmail = env.FROM_EMAIL || 'amit@amitphotos.com';
      const confirmHtml = `<div dir="rtl" style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:2rem;color:#111">
        <h2 style="color:#c8a96e;font-family:sans-serif">AMIT PHOTOS</h2>
        <p>שלום${name ? ' ' + name : ''},</p>
        <p>תודה שנרשמת לניוזלטר של עמית פוטוס! 🎉</p>
        <p>תקבל עדכונים על תמונות חדשות, מבצעים בלעדיים ותוכן מאחורי הקלעים — ישירות למייל.</p>
        <hr style="margin-top:2rem;border-color:#ddd">
        <p style="color:#999;font-size:.8rem">קיבלת מייל זה כי נרשמת לניוזלטר של <a href="https://amitphotos.com">amitphotos.com</a>.</p>
      </div>`;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromEmail, to: email, subject: 'ברוך הבא לניוזלטר של עמית פוטוס!', html: confirmHtml })
      });
    }

    return jsonRes({ ok: true, id }, 200, request);
  }

  // GET ו-DELETE דורשים auth
  if (!await checkAuth(request, env)) return unauth(request);

  if (method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM subscribers ORDER BY created_at DESC'
    ).all();
    return jsonRes(results);
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
  const method = request.method;

  // POST פתוח לציבור — פניות מטופס צור קשר באתר
  if (method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { id, name, email, phone, date, type, status, subject, notes } = body;
    if (!name) return jsonRes({ error: 'שם חסר' }, 400, request);
    if (id) {
      if (!await checkAuth(request, env)) return unauth(request);
      await env.DB.prepare(
        `UPDATE customers SET name=?,email=?,phone=?,date=?,type=?,status=?,subject=?,notes=? WHERE id=?`
      ).bind(name, email||'', phone||'', date||'', type||'', status||'', subject||'', notes||'', id).run();
      return jsonRes({ ok: true, id }, 200, request);
    } else {
      const newId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO customers (id,name,email,phone,date,type,status,subject,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(newId, name, email||'', phone||'', date||'', type||'פנייה', status||'ממתין', subject||'', notes||'', new Date().toISOString()).run();
      return jsonRes({ ok: true, id: newId }, 200, request);
    }
  }

  // GET ו-DELETE דורשים auth
  if (!await checkAuth(request, env)) return unauth(request);

  if (method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM customers ORDER BY created_at DESC'
    ).all();
    return jsonRes(results);
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
  const method = request.method;

  if (method === 'GET') {
    const url = new URL(request.url);
    const adminAll = url.searchParams.get('admin') === '1';
    // ?admin=1 מחייב auth; גישה ציבורית — רק published
    if (adminAll && !await checkAuth(request, env)) return unauth(request);
    const sql = adminAll
      ? 'SELECT * FROM photos ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order ASC, created_at DESC'
      : 'SELECT * FROM photos WHERE published=1 ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order ASC, created_at DESC';
    const { results } = await env.DB.prepare(sql).all();
    const { results: settingsRows } = await env.DB.prepare(
      "SELECT key, value FROM settings WHERE key IN ('photo_of_week_id','photo_of_week_discount','photo_of_week_caption','photo_of_week_caption_en')"
    ).all();
    const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
    const weekPhotoId   = settings['photo_of_week_id'] || '';
    const weekDiscount  = parseFloat(settings['photo_of_week_discount'] || '0.25');
    const weekCaption   = settings['photo_of_week_caption'] || '';
    const weekCaptionEn = settings['photo_of_week_caption_en'] || '';
    const photos = results.map(p => ({
      ...p,
      is_week_photo: !!(weekPhotoId && p.id === weekPhotoId),
      week_photo_discount: (weekPhotoId && p.id === weekPhotoId) ? weekDiscount : 0,
      week_photo_caption: (weekPhotoId && p.id === weekPhotoId) ? weekCaption : '',
      week_photo_caption_en: (weekPhotoId && p.id === weekPhotoId) ? weekCaptionEn : '',
    }));
    return jsonRes(photos);
  }

  if (!await checkAuth(request, env)) return unauth(request);

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
    if (!await checkAuth(request, env)) return unauth(request);
    const body = await request.json().catch(() => ({}));
    const { id } = body;
    if (!id) return jsonRes({ error: 'id חסר' }, 400, request);

    if (body.published !== undefined) {
      await env.DB.prepare('UPDATE photos SET published=? WHERE id=?').bind(body.published ? 1 : 0, id).run();
      return jsonRes({ ok: true, published: body.published ? 1 : 0 }, 200, request);
    }

    if (body.quiz_eligible !== undefined || body.quiz_description !== undefined) {
      const current = await env.DB.prepare('SELECT quiz_eligible, quiz_description FROM photos WHERE id=?').bind(id).first();
      if (!current) return jsonRes({ error: 'תמונה לא נמצאה' }, 404, request);
      const newEligible = body.quiz_eligible !== undefined ? (body.quiz_eligible ? 1 : 0) : current.quiz_eligible;
      const newDesc     = body.quiz_description !== undefined ? body.quiz_description : current.quiz_description;
      await env.DB.prepare('UPDATE photos SET quiz_eligible=?, quiz_description=? WHERE id=?').bind(newEligible, newDesc, id).run();
      return jsonRes({ ok: true, quiz_eligible: newEligible, quiz_description: newDesc }, 200, request);
    }

    if (body.on_sale !== undefined) {
      const newOnSale = body.on_sale ? 1 : 0;
      const startedAt = body.on_sale ? new Date().toISOString() : null;
      await env.DB.prepare(
        'UPDATE photos SET on_sale=?, sale_started_at=? WHERE id=?'
      ).bind(newOnSale, startedAt, id).run();
      return jsonRes({ ok: true, on_sale: newOnSale }, 200, request);
    }

    let finalTitle = body.title || '';
    // אם הכותרת גנרית — נסה לייצר עברית אוטומטית
    if (isGenericTitle(finalTitle)) {
      const row = await env.DB.prepare('SELECT r2_key FROM photos WHERE id=?').bind(id).first();
      if (row?.r2_key) {
        const origin = new URL(request.url).origin;
        const aiTitle = await generateHebrewTitle(`${origin}/photos/${row.r2_key}`, body.category || '', env);
        if (aiTitle) finalTitle = aiTitle;
      }
    }
    await env.DB.prepare(
      'UPDATE photos SET title=?,category=?,description=? WHERE id=?'
    ).bind(finalTitle, body.category || '', body.description || '', id).run();
    return jsonRes({ ok: true, title: finalTitle }, 200, request);
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

async function handleQuizPhotos(request, env) {
  const { results } = await env.DB.prepare(
    'SELECT id, title, category, thumbnail, url, quiz_description FROM photos WHERE published=1 AND quiz_eligible=1'
  ).all();
  const weekRow = await env.DB.prepare(
    "SELECT value FROM settings WHERE key='photo_of_week_id'"
  ).first();
  const weekId = weekRow?.value || '';
  const photos = results.map(p => weekId && p.id === weekId ? { ...p, is_week_photo: true } : p);
  return jsonRes(photos);
}

async function handleSalePhotos(request, env) {
  const { results } = await env.DB.prepare(
    'SELECT id, title, category, thumbnail, url, sale_started_at FROM photos WHERE published=1 AND on_sale=1 ORDER BY RANDOM()'
  ).all();
  return jsonRes(results, 200, request);
}

async function handleSaleRotate(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);

  const now = new Date().toISOString();
  const nextRotation = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare('UPDATE photos SET on_sale=0, sale_started_at=NULL WHERE on_sale=1').run();

  const { results } = await env.DB.prepare(
    'SELECT id FROM photos WHERE published=1 ORDER BY RANDOM() LIMIT 50'
  ).all();

  if (results.length === 0) return jsonRes({ error: 'No published photos found' }, 400, request);

  const stmts = results.map(photo =>
    env.DB.prepare('UPDATE photos SET on_sale=1, sale_started_at=? WHERE id=?')
      .bind(now, photo.id)
  );
  await env.DB.batch(stmts);

  return jsonRes({ ok: true, rotated: results.length, next_rotation: nextRotation }, 200, request);
}

// ===== REPAIR R2 — overwrite existing R2 key without touching D1 =====
async function handleRepairR2(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  if (!await checkAuth(request, env)) return unauth(request);
  const formData = await request.formData();
  const key = formData.get('key');
  const file = formData.get('file');
  if (!key || !file || typeof file === 'string') return jsonRes({ error: 'key/file חסר' }, 400, request);
  await env.PHOTOS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'image/jpeg' },
  });
  return jsonRes({ ok: true, key }, 200, request);
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

  try {
    await env.PHOTOS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || 'image/jpeg' },
    });
  } catch (e) {
    return jsonRes({ error: `R2 upload failed: ${e.message}` }, 500, request);
  }

  // שמור thumbnail אם נשלח
  const thumb = formData.get('thumb');
  let thumbUrl = `/photos/${key}`;
  if (thumb && typeof thumb !== 'string') {
    const thumbKey = `thumb_${id}.jpg`;
    try {
      await env.PHOTOS.put(thumbKey, thumb.stream(), {
        httpMetadata: { contentType: 'image/jpeg' },
      });
    } catch { /* thumb failure is non-fatal */ }
    thumbUrl = `/photos/${thumbKey}`;
  }

  const url = `/photos/${key}`;
  const category = formData.get('category') || '';
  let title = formData.get('title') || '';
  const width  = parseInt(formData.get('width')  || '0', 10) || null;
  const height = parseInt(formData.get('height') || '0', 10) || null;

  // אם אין כותרת עברית — נסה לייצר אחת אוטומטית
  if (isGenericTitle(title)) {
    const origin = new URL(request.url).origin;
    const aiTitle = await generateHebrewTitle(`${origin}${url}`, category, env);
    if (aiTitle) title = aiTitle;
  }

  const published = formData.get('published') === '1' ? 1 : 0;
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO photos (id,title,category,description,filename,r2_key,url,thumbnail,width,height,created_at,added_at,published) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id, title, category,
      formData.get('description') || '',
      file.name, key, url, thumbUrl,
      width, height,
      now, now.slice(0, 10), published
    ).run();
  } catch (e) {
    return jsonRes({ error: `DB insert failed: ${e.message}` }, 500, request);
  }

  return jsonRes({ ok: true, id, url, thumbnail: thumbUrl, key, title });
}

// ===== TRIGGER GITHUB ACTIONS =====
function dispatchWorkflow(workflow, env) {
  if (!env.GITHUB_TOKEN) return;
  fetch(
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
  ).catch(() => {});
}

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

async function generateHebrewTitle(imageUrl, category, env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 30,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            { type: 'text', text: `זוהי תמונה מגלריית הצילום של הצלם עמית ארז, קטגוריה: ${category || 'כללי'}.\nתן לתמונה כותרת קצרה ויפה בעברית — 2 עד 4 מילים בלבד.\nחובה: השתמש באותיות עבריות בלבד (Unicode U+05D0–U+05EA ורווחים). אסור בתכלית האיסור להשתמש בערבית, סינית, אנגלית או כל שפה אחרת.\nהחזר רק את הכותרת, ללא פיסוק נוסף.` }
          ]
        }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data.content?.[0]?.text?.replace(/[\*_`#\n\r]/g, '').trim().replace(/^['"]|['"]$/g, '') || null;
    // דחה כותרת שמכילה תווים שאינם עברית/רווח
    if (raw && /[^\u05D0-\u05EA\u05F0-\u05F4 ,.\-–—'״׳]/.test(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

async function handleGenerateAlt(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: 'ANTHROPIC_API_KEY לא מוגדר' }, 500, request);

  const { urls } = await request.json().catch(() => ({}));
  if (!Array.isArray(urls) || !urls.length) return jsonRes({ error: 'urls חסר' }, 400, request);

  const results = [];
  for (const { id, url, category } of urls) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 60,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'url', url } },
              { type: 'text', text: `זוהי תמונה מגלריית הצילום של הצלם עמית ארז, קטגוריה: ${category || 'כללי'}.\nכתוב alt text קצר ותיאורי בעברית — משפט אחד, עד 10 מילים.\nהחזר רק את הטקסט, ללא פיסוק נוסף.` }
            ]
          }]
        })
      });
      if (res.ok) {
        const data = await res.json();
        const alt = data.content?.[0]?.text?.replace(/[\*_`#\n\r]/g, '').trim() || null;
        results.push({ id, alt });
      } else {
        results.push({ id, alt: null, error: res.status });
      }
    } catch (e) {
      results.push({ id, alt: null, error: String(e) });
    }
  }
  return jsonRes({ results }, 200, request);
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
          model: 'claude-sonnet-4-6',
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
      const title = data.content?.[0]?.text?.replace(/[\*_`#\n\r]/g, '').trim().replace(/^['"]|['"]$/g, '');
      if (title) {
        await env.DB.prepare('UPDATE photos SET title=? WHERE id=?').bind(title, photo.id).run();
        updated.push({ id: photo.id, title });
      }
    } catch { /* המשך לתמונה הבאה */ }
  }

  return jsonRes({ updated: updated.length, total: toFill.length, titles: updated });
}

// ===== DOWNLOAD TOKEN =====
async function handleDownload(request, env, token) {
  if (!token) return jsonRes({ error: 'token חסר' }, 400, request);

  const row = await env.DB.prepare(
    'SELECT * FROM download_tokens WHERE token = ?'
  ).bind(token).first();

  if (!row) return jsonRes({ error: 'קישור לא תקין' }, 404, request);
  if (row.used) return jsonRes({ error: 'קישור זה כבר שומש' }, 410, request);
  if (Math.floor(Date.now() / 1000) > row.expires_at) return jsonRes({ error: 'פג תוקף הקישור' }, 410, request);

  // Mark as used before serving (prevents reuse even if fetch fails)
  await env.DB.prepare('UPDATE download_tokens SET used = 1 WHERE token = ?').bind(token).run();

  // Get photo from D1
  const photoIds = JSON.parse(row.photo_ids);
  const photoId = photoIds[0];
  const photo = await env.DB.prepare('SELECT r2_key, title FROM photos WHERE id = ?').bind(photoId).first();

  // R2 photo
  if (photo?.r2_key) {
    const object = await env.PHOTOS.get(photo.r2_key);
    if (!object) return jsonRes({ error: 'קובץ לא נמצא ב-R2' }, 404, request);
    const filename = (photo.title || 'photo').replace(/[^\w\u0590-\u05ff .-]/g, '_') + '.jpg';
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // Google Drive fallback — photo not in R2 yet
  const SZ_MAP = { small: 'w1500', medium: 'w3000', large: null };
  const sz = SZ_MAP[row.size];
  const driveUrl = sz
    ? `https://lh3.googleusercontent.com/d/${photoId}=${sz}`
    : `https://drive.google.com/uc?export=download&id=${photoId}`;
  return Response.redirect(driveUrl, 302);
}

// ===== PURCHASE NOTIFICATIONS =====
async function sendPurchaseEmail(env, { titles, size, amount, txnId, tokens, origin }) {
  if (!env.RESEND_API_KEY) return;
  const adminEmail = env.ADMIN_EMAIL || 'contact@amitphotos.com';
  const fromEmail = 'Amit Photos <onboarding@resend.dev>';
  const sizeLabel = { small: 'קובץ רשת', medium: 'קובץ הדפסה', large: 'קובץ מלא' }[size] || size;
  const tokenLinks = tokens.map(t => `<a href="${origin}/api/download/${t}">${origin}/api/download/${t}</a>`).join('<br>');
  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;padding:24px">
      <h2>📸 רכישה חדשה ב-Amit Photos!</h2>
      <p><strong>תמונות:</strong> ${titles.join(', ')}</p>
      <p><strong>גודל:</strong> ${sizeLabel}</p>
      <p><strong>סכום:</strong> ₪${amount}</p>
      <p><strong>Transaction:</strong> ${txnId}</p>
      <p><strong>קישורי הורדה:</strong><br>${tokenLinks}</p>
    </div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromEmail, to: adminEmail, subject: `רכישה חדשה 📸 — ${titles[0]} (${sizeLabel})`, html }),
  }).catch(() => {});
}

async function sendPurchaseTelegram(env, { titles, size, amount, txnId }) {
  if (!env.CALLMEBOT_TELEGRAM_USER) return;
  const sizeLabel = { small: 'רשת', medium: 'הדפסה', large: 'מלא' }[size] || size;
  const msg = `רכישה חדשה! 📸 ${titles.join(', ')} | ${sizeLabel} | ₪${amount} | ${txnId}`;
  const url = `https://api.callmebot.com/text.php?user=@${env.CALLMEBOT_TELEGRAM_USER}&text=${encodeURIComponent(msg)}`;
  await fetch(url).catch(() => {});
}

// ===== VERIFY PAYPAL PAYMENT (PDT — server-to-server) =====
async function handleVerifyPayment(request, env, ctx) {
  if (request.method !== 'GET') return jsonRes({ error: 'method not allowed' }, 405, request);
  const url = new URL(request.url);
  const params = url.searchParams;

  // PayPal שולח את כל הפרמטרים ב-return URL כשמוגדר rm=2
  const txnId         = params.get('txn_id') || params.get('tx');
  const itemNumber    = params.get('item_number');
  const paymentStatus = params.get('payment_status');
  const mcCurrency    = params.get('mc_currency');

  if (!txnId)      return jsonRes({ error: 'חסר transaction ID' }, 400, request);
  if (!itemNumber) return jsonRes({ error: 'item_number חסר' }, 400, request);

  const receiverId    = params.get('receiver_id');
  const PAYPAL_RECEIVER_ID = env.PAYPAL_RECEIVER_ID;

  if (paymentStatus !== 'Completed')     return jsonRes({ error: `סטטוס תשלום: ${paymentStatus || 'חסר'}` }, 402, request);
  if (receiverId !== PAYPAL_RECEIVER_ID) return jsonRes({ error: 'חשבון PayPal לא תואם' }, 402, request);
  if (mcCurrency !== 'ILS')             return jsonRes({ error: 'מטבע לא תואם' }, 402, request);

  // פענוח item_number
  let photoIds, size;
  if (itemNumber.startsWith('CART_')) {
    const rest = itemNumber.slice(5);
    const firstUnderscore = rest.indexOf('_');
    if (firstUnderscore === -1) return jsonRes({ error: 'item_number לא תקין' }, 400, request);
    size = rest.substring(0, firstUnderscore);
    photoIds = rest.substring(firstUnderscore + 1).split(',').filter(Boolean);
  } else {
    const lastUnderscore = itemNumber.lastIndexOf('_');
    if (lastUnderscore === -1) return jsonRes({ error: 'item_number לא תקין' }, 400, request);
    photoIds = [itemNumber.substring(0, lastUnderscore)];
    size = itemNumber.substring(lastUnderscore + 1);
  }

  const VALID_SIZES = ['small', 'medium', 'large'];
  if (!VALID_SIZES.includes(size)) return jsonRes({ error: 'גודל לא תקין' }, 400, request);

  // בדיקת סכום — לוודא שהסכום ששולם תואם למחיר הנכון
  const PRICES = await getGlobalPrices(env);
  const BUNDLE_MIN = 3;
  const BUNDLE_DISCOUNT = 0.1;
  const mcGross = parseFloat(params.get('mc_gross') || 0);
  let unitPrice = PRICES[size];
  // per-photo price override (only for single-photo purchases)
  if (photoIds.length === 1) {
    const photoRow = await env.DB.prepare("SELECT price_overrides FROM photos WHERE id = ?").bind(photoIds[0]).first();
    if (photoRow?.price_overrides) {
      try {
        const ov = JSON.parse(photoRow.price_overrides);
        if (ov[size] != null) unitPrice = ov[size];
      } catch {}
    }
  }
  const subtotal = photoIds.length * unitPrice;
  const discount = photoIds.length >= BUNDLE_MIN ? Math.round(subtotal * BUNDLE_DISCOUNT) : 0;
  const expectedPrice = subtotal - discount;

  if (mcGross < expectedPrice) {
    return jsonRes({ error: `סכום ששולם (${mcGross}₪) נמוך מהמחיר (${expectedPrice}₪)` }, 402, request);
  }

  if (!txnId) return jsonRes({ error: 'txn_id חסר' }, 402, request);

  const existing = await env.DB.prepare('SELECT token FROM download_tokens WHERE tx = ? LIMIT 1').bind(txnId).first();
  if (existing) return jsonRes({ error: 'עסקה זו כבר עובדה' }, 409, request);

  // יצירת download tokens ב-D1
  const now = Math.floor(Date.now() / 1000);
  const expires = now + 86400; // 24 שעות
  const tokens = [];

  for (const photoId of photoIds) {
    const token = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at, amount) VALUES (?, ?, ?, ?, 0, ?, ?, ?)'
    ).bind(token, JSON.stringify([photoId]), size, txnId, expires, now, mcGross / photoIds.length).run();
    tokens.push(token);
  }

  // Collect titles and send notifications (fire-and-forget)
  const notifTitles = await Promise.all(photoIds.map(async id => {
    const r = await env.DB.prepare('SELECT title FROM photos WHERE id = ?').bind(id).first();
    return r?.title || id;
  }));
  const origin = new URL(request.url).origin;
  ctx.waitUntil(sendPurchaseEmail(env, { titles: notifTitles, size, amount: mcGross, txnId, tokens, origin }));
  ctx.waitUntil(sendPurchaseTelegram(env, { titles: notifTitles, size, amount: mcGross, txnId }));

  if (tokens.length === 1) {
    return jsonRes({ url: `/api/download/${tokens[0]}`, title: notifTitles[0] }, 200, request);
  }

  const urlItems = photoIds.map((photoId, i) => ({ url: `/api/download/${tokens[i]}`, title: notifTitles[i] }));
  return jsonRes({ urls: urlItems, title: params.get('item_name') || 'חבילת תמונות' }, 200, request);
}

function parsePDTResponse(text) {
  const lines = text.split('\n');
  const result = {};
  for (let i = 1; i < lines.length; i++) {
    const eq = lines[i].indexOf('=');
    if (eq !== -1) {
      result[decodeURIComponent(lines[i].substring(0, eq).trim())] =
        decodeURIComponent(lines[i].substring(eq + 1).trim());
    }
  }
  return result;
}

// ===== PRINT SHOP =====

const GELATO_API = 'https://order.gelatoapis.com/v4';

const PRINT_CATALOG = {
  poster: {
    label: 'פוסטר — נייר אמנות מט',
    desc: 'נייר אמנות 170gsm, פינישינג מט — כולל משלוח לישראל',
    sizes: [
      { label: '20×25 ס"מ (8×10")', sku: 'flat_200x250-mm-8x10-inch_170-gsm-65lb-uncoated_4-0_ver',  minW: 2400, minH: 3000 },
      { label: '30×40 ס"מ (12×16")',sku: 'flat_300x400-mm-12x16-inch_170-gsm-65lb-uncoated_4-0_ver', minW: 3543, minH: 4724 },
      { label: '40×50 ס"מ (16×20")',sku: 'flat_400x500-mm-16x20-inch_170-gsm-65lb-uncoated_4-0_ver', minW: 4724, minH: 5906 },
      { label: 'A3 — 30×42 ס"מ',   sku: 'flat_a3_170-gsm-65lb-uncoated_4-0_ver',                    minW: 3508, minH: 4961 },
      { label: 'A2 — 42×59 ס"מ',   sku: 'flat_a2_170-gsm-65lb-uncoated_4-0_ver',                    minW: 4961, minH: 7016 },
      { label: '45×60 ס"מ (18×24")',sku: 'flat_450x600-mm-18x24-inch_170-gsm-65lb-uncoated_4-0_ver', minW: 5315, minH: 7087 },
      { label: '60×90 ס"מ (24×36")',sku: 'flat_600x900-mm-24x36-inch_170-gsm-65lb-uncoated_4-0_ver', minW: 7087, minH: 10630 },
    ]
  },
  canvas: {
    label: 'הדפסה על קנבס',
    desc: 'קנבס מתוח על מסגרת עץ, מוכן לתלייה — כולל משלוח לישראל',
    sizes: [
      { label: '20×20 ס"מ', sku: 'canvas_200x200-mm-8x8-inch_canvas_wood-fsc-slim_4-0_ver',    minW: 2362, minH: 2362 },
      { label: '20×25 ס"מ', sku: 'canvas_200x250-mm-8x10-inch_canvas_wood-fsc-slim_4-0_ver',   minW: 2362, minH: 2953 },
      { label: '30×40 ס"מ', sku: 'canvas_12x16-inch-300x400-mm_canvas_wood-fsc-slim_4-0_ver',  minW: 3543, minH: 4724 },
      { label: '40×50 ס"מ', sku: 'canvas_16x20-inch-400x500-mm_canvas_wood-fsc-slim_4-0_ver',  minW: 4724, minH: 5906 },
      { label: '45×60 ס"מ', sku: 'canvas_18x24-inch-450x600-mm_canvas_wood-fsc-slim_4-0_ver',  minW: 5315, minH: 7087 },
    ]
  },
  metallic: {
    label: 'הדפסה על מתכת',
    desc: 'הדפסה על אלומיניום 3mm — גימור מבריק יוקרתי, מוכן לתלייה — כולל משלוח לישראל',
    sizes: [
      { label: '30×30 ס"מ (12×12")', sku: 'metallic_12x12-inch-300x300-mm_3-mm_4-0_ver', minW: 3543, minH: 3543 },
      { label: '30×40 ס"מ (12×16")', sku: 'metallic_12x16-inch-300x400-mm_3-mm_4-0_ver', minW: 3543, minH: 4724 },
      { label: '30×45 ס"מ (12×18")', sku: 'metallic_12x18-inch-300x450-mm_3-mm_4-0_ver', minW: 3543, minH: 5315 },
    ]
  }
};

async function handlePrintCatalog(request, env) {
  return jsonRes(PRINT_CATALOG, 200, request);
}

async function handlePrintQuote(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  const { sku } = await request.json().catch(() => ({}));
  if (!sku) return jsonRes({ error: 'sku חסר' }, 400, request);
  if (!env.GELATO_API_KEY) return jsonRes({ error: 'GELATO_API_KEY לא מוגדר' }, 500, request);

  const res = await fetch(`${GELATO_API}/orders:quote`, {
    method: 'POST',
    headers: { 'X-API-KEY': env.GELATO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderType: 'order',
      orderReferenceId: `quote-${Date.now()}`,
      customerReferenceId: 'quote',
      currency: 'USD',
      recipient: { country: 'IL' },
      products: [{ itemReferenceId: 'item-1', productUid: sku, quantity: 1 }]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return jsonRes({ error: err.message || `שגיאת Gelato: ${res.status}` }, 500, request);
  }

  const data = await res.json();
  const quote = data.quotes?.[0];
  if (!quote) return jsonRes({ error: 'לא התקבלה הצעת מחיר' }, 500, request);

  const productCost = parseFloat(quote.products?.[0]?.price || 0);
  const methods = quote.shipmentMethods || [];
  const cheapestMethod = methods.length ? methods.reduce((a, b) => a.price < b.price ? a : b) : null;
  const shippingCost = parseFloat(cheapestMethod?.price || 0);
  const totalCost = productCost + shippingCost;
  // Markup: 1.6x total cost (product + shipping), rounded up to nearest $5
  const sellPrice = Math.ceil((totalCost * 1.6) / 5) * 5;
  return jsonRes({ sellPrice, sku }, 200, request);
}

async function handlePrintOrderComplete(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  const { tx, itemNumber, allParams } = await request.json().catch(() => ({}));
  if (!tx || !itemNumber) return jsonRes({ error: 'חסרים פרמטרים' }, 400, request);

  // Parse: PRINT_{photoId}_{sku}
  if (!itemNumber.startsWith('PRINT_')) return jsonRes({ error: 'item_number לא תקין' }, 400, request);
  const rest = itemNumber.slice(6);
  const firstUnderscore = rest.indexOf('_');
  if (firstUnderscore === -1) return jsonRes({ error: 'item_number לא תקין' }, 400, request);
  const photoId = rest.substring(0, firstUnderscore);
  const sku = rest.substring(firstUnderscore + 1);

  // Verify PayPal via return-URL params (rm=2 sends all fields)
  const urlParams = new URLSearchParams(allParams || '');
  const paymentStatus = urlParams.get('payment_status');
  const receiverId = urlParams.get('receiver_id');
  const mcCurrency = urlParams.get('mc_currency');
  const PAYPAL_RECEIVER_ID = env.PAYPAL_RECEIVER_ID;

  if (paymentStatus !== 'Completed') return jsonRes({ error: `סטטוס תשלום: ${paymentStatus || 'חסר'}` }, 402, request);
  if (receiverId !== PAYPAL_RECEIVER_ID) return jsonRes({ error: 'חשבון PayPal לא תואם' }, 402, request);
  if (mcCurrency !== 'USD') return jsonRes({ error: 'מטבע לא תואם' }, 402, request);

  // Prevent duplicate Gelato orders for the same transaction
  const existingOrder = await env.DB.prepare('SELECT id FROM print_orders WHERE paypal_tx = ? LIMIT 1').bind(tx).first();
  if (existingOrder) return jsonRes({ orderId: existingOrder.id }, 200, request);

  // Decode address from custom field (URLSearchParams turns + into space, restore before atob)
  let address;
  try {
    const customRaw = (urlParams.get('custom') || '').replace(/ /g, '+');
    address = JSON.parse(atob(customRaw));
  }
  catch { return jsonRes({ error: 'נתוני כתובת חסרים' }, 400, request); }

  // Get photo URL from DB; prefer pre-cropped URL if client uploaded one
  const origin = new URL(request.url).origin;
  const photo = await env.DB.prepare('SELECT url FROM photos WHERE id=?').bind(photoId).first();
  if (!photo) return jsonRes({ error: 'תמונה לא נמצאה' }, 404, request);
  const originalUrl = photo.url.startsWith('http') ? photo.url : `${origin}${photo.url}`;
  const photoUrl = address.cropUrl || originalUrl;

  // Resolve product entry
  const typeEntry = Object.values(PRINT_CATALOG).find(t => t.sizes.some(s => s.sku === sku));
  const sizeEntry = typeEntry?.sizes.find(s => s.sku === sku);

  // Create Gelato order
  const orderId = crypto.randomUUID();
  const gelatoRes = await fetch(`${GELATO_API}/orders`, {
    method: 'POST',
    headers: { 'X-API-KEY': env.GELATO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderType: 'order',
      orderReferenceId: orderId,
      customerReferenceId: orderId,
      currency: 'USD',
      shippingAddress: (() => {
        const parts = (address.name || '').trim().split(/\s+/);
        const firstName = parts[0] || 'לקוח';
        const lastName = parts.slice(1).join(' ') || '-';
        return {
          firstName,
          lastName,
          email: address.email || '',
          phone: address.phone || '',
          addressLine1: address.line1,
          city: address.city,
          postCode: address.zip,
          country: 'IL'
        };
      })(),
      items: [{
        itemReferenceId: `item-${orderId}`,
        productUid: sku,
        quantity: 1,
        files: [{ type: 'default', url: photoUrl }]
      }]
    })
  });

  if (!gelatoRes.ok) {
    const err = await gelatoRes.json().catch(() => ({}));
    return jsonRes({ error: `שגיאת Gelato: ${err.message || gelatoRes.status}` }, 500, request);
  }
  const pd = await gelatoRes.json();
  const gelatoOrderId = pd.id || '';

  // Human-readable product label
  const productLabel = typeEntry && sizeEntry ? `${typeEntry.label} — ${sizeEntry.label}` : sku;
  const sellPrice = parseFloat(urlParams.get('mc_gross') || 0);

  await env.DB.prepare(
    `INSERT INTO print_orders (id, prodigi_order_id, photo_id, sku, product_label, sell_price, customer_name, customer_email, customer_phone, address_line1, address_city, address_zip, paypal_tx, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_production', ?)`
  ).bind(
    orderId, gelatoOrderId, photoId, sku, productLabel, sellPrice,
    address.name, address.email || '', address.phone || '',
    address.line1, address.city, address.zip,
    tx, new Date().toISOString()
  ).run();

  // Send confirmation email with cancel link
  if (address.email && env.RESEND_API_KEY) {
    const fromEmail = env.FROM_EMAIL || 'amit@amitphotos.com';
    const cancelUrl = `${origin}/api/print/cancel?token=${orderId}`;
    const confirmHtml = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
        <tr><td style="background:#0a0a0a;padding:24px 40px;text-align:center">
          <div style="color:#c8a96e;font-size:20px;font-weight:700;letter-spacing:.25em;font-family:Georgia,serif">AMIT PHOTOS</div>
        </td></tr>
        <tr><td style="padding:32px 40px;color:#222;font-size:15px;line-height:1.85;direction:rtl;text-align:right">
          <h2 style="margin:0 0 1rem;font-size:18px">שלום ${address.name}, ההזמנה התקבלה!</h2>
          <p><strong>מוצר:</strong> ${productLabel}</p>
          <p><strong>כתובת:</strong> ${address.line1}, ${address.city} ${address.zip}</p>
          <p><strong>מחיר ששולם:</strong> $${sellPrice}</p>
          <p style="color:#888;font-size:.9rem">זמן משלוח משוער: 7–10 ימי עסקים.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:1.5rem 0">
          <p style="color:#555;font-size:.88rem">רוצה לבטל? ניתן לבטל תוך שעה מרגע ההזמנה:</p>
          <p style="text-align:center;margin:1rem 0">
            <a href="${cancelUrl}" style="background:#c8a96e;color:#0a0a0a;padding:.7rem 2rem;border-radius:6px;text-decoration:none;font-weight:700;font-size:.95rem">ביטול הזמנה</a>
          </p>
          <p style="color:#aaa;font-size:.78rem;text-align:center">הכפתור יפסיק לעבוד לאחר שעה</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to: address.email, subject: 'אישור הזמנת הדפסה — Amit Photos', html: confirmHtml })
    });

    // Admin notification
    const adminEmail = env.ADMIN_EMAIL || 'contact@amitphotos.com';
    const adminHtml = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:32px;background:#f4f4f4;font-family:Arial,sans-serif">
  <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:8px;padding:2rem;border:1px solid #ddd">
    <div style="color:#c8a96e;font-size:1rem;font-weight:700;letter-spacing:.2em;margin-bottom:1.5rem">AMIT PHOTOS — הזמנה חדשה 🖨️</div>
    <table style="width:100%;border-collapse:collapse;font-size:.92rem;direction:rtl">
      <tr><td style="padding:.4rem 0;color:#888;width:35%">לקוח</td><td><strong>${address.name}</strong></td></tr>
      <tr><td style="padding:.4rem 0;color:#888">טלפון</td><td><a href="tel:${address.phone}" style="color:#c8a96e">${address.phone||'—'}</a></td></tr>
      <tr><td style="padding:.4rem 0;color:#888">מייל</td><td><a href="mailto:${address.email}" style="color:#c8a96e">${address.email}</a></td></tr>
      <tr><td style="padding:.4rem 0;color:#888">כתובת</td><td>${address.line1}, ${address.city} ${address.zip}</td></tr>
      <tr><td style="padding:.4rem 0;color:#888">מוצר</td><td>${productLabel}</td></tr>
      <tr><td style="padding:.4rem 0;color:#888">מחיר</td><td><strong>$${sellPrice}</strong></td></tr>
      <tr><td style="padding:.4rem 0;color:#888">Gelato ID</td><td style="font-size:.82rem;color:#aaa">${gelatoOrderId||'—'}</td></tr>
    </table>
  </div>
</body></html>`;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to: adminEmail, subject: `הזמנת הדפסה חדשה — ${address.name} ($${sellPrice})`, html: adminHtml })
    });
  }

  return jsonRes({ ok: true, orderId: gelatoOrderId || orderId }, 200, request);
}

async function handlePrintCancel(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return new Response('קישור לא תקין', { status: 400 });

  const order = await env.DB.prepare('SELECT * FROM print_orders WHERE id=?').bind(token).first();
  if (!order) return new Response(cancelPage('הזמנה לא נמצאה', false), { status: 404, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

  if (order.status === 'cancelled') {
    return new Response(cancelPage('ההזמנה כבר בוטלה', false), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  // Check 1-hour window
  const created = new Date(order.created_at);
  const diffMin = (Date.now() - created.getTime()) / 60000;
  if (diffMin > 60) {
    return new Response(cancelPage('פג תוקף הביטול (שעה אחרי ההזמנה)', false), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  // Cancel at Gelato
  if (order.prodigi_order_id) {
    await fetch('https://api.gelato.com/v2/order/cancel', {
      method: 'POST',
      headers: { 'X-API-KEY': env.GELATO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderReferenceId: order.prodigi_order_id })
    }).catch(() => {});
  }

  await env.DB.prepare('UPDATE print_orders SET status=? WHERE id=?').bind('cancelled', token).run();

  return new Response(cancelPage('ההזמנה בוטלה בהצלחה', true), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

function cancelPage(message, success) {
  const color = success ? '#4caf7d' : '#e55';
  const icon = success ? '✅' : '❌';
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${message} — Amit Photos</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:#0a0a0a;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}.card{background:#141414;border:1px solid #222;border-radius:12px;padding:3rem 2.5rem;max-width:440px;width:100%;text-align:center}.logo{color:#c8a96e;font-size:1rem;letter-spacing:.25em;margin-bottom:2rem}.icon{font-size:3rem;margin-bottom:1rem}h1{font-size:1.3rem;margin-bottom:.75rem;color:${color}}p{color:#888;font-size:.9rem;line-height:1.7;margin-bottom:1rem}.btn{display:inline-block;margin-top:1.5rem;padding:.7rem 1.8rem;background:#c8a96e;color:#0a0a0a;border-radius:6px;text-decoration:none;font-weight:700;font-size:.9rem}</style>
</head>
<body>
  <div class="card">
    <div class="logo">AMIT PHOTOS</div>
    <div class="icon">${icon}</div>
    <h1>${message}</h1>
    ${success ? '<p>ההחזר הכספי יבוצע דרך PayPal תוך 3–5 ימי עסקים.</p>' : '<p>לעזרה נוספת צרו קשר: <a href="mailto:contact@amitphotos.com" style="color:#c8a96e">contact@amitphotos.com</a></p>'}
    <a href="https://amitphotos.com" class="btn">חזרה לאתר</a>
  </div>
</body></html>`;
}

async function handlePrintRefreshStatus(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  if (!await checkAuth(request, env)) return unauth(request);

  const { orderId } = await request.json().catch(() => ({}));
  if (!orderId) return jsonRes({ error: 'orderId חסר' }, 400, request);

  const order = await env.DB.prepare(
    'SELECT id, prodigi_order_id, status FROM print_orders WHERE id=?'
  ).bind(orderId).first();
  if (!order) return jsonRes({ error: 'הזמנה לא נמצאה' }, 404, request);

  const gelatoOrderId = order.prodigi_order_id;
  if (!gelatoOrderId) return jsonRes({ error: 'אין Gelato order ID' }, 400, request);

  const gelatoRes = await fetch(
    `https://api.gelato.com/v2/order/status/${gelatoOrderId}`,
    { headers: { 'X-API-KEY': env.GELATO_API_KEY } }
  );
  if (!gelatoRes.ok) {
    const err = await gelatoRes.text();
    return jsonRes({ error: `שגיאת Gelato: ${gelatoRes.status} ${err}` }, 502, request);
  }
  const gelatoData = await gelatoRes.json();

  const STATUS_MAP = {
    'created':       'in_production',
    'passed':        'in_production',
    'in_production': 'in_production',
    'printed':       'in_production',
    'shipped':       'shipped',
    'delivered':     'shipped',
    'cancelled':     'cancelled',
    'failed':        'cancelled',
  };
  const rawStatus = (gelatoData.productionStatus || '').toLowerCase();
  const newStatus = STATUS_MAP[rawStatus];

  if (newStatus && newStatus !== order.status && order.status !== 'cancelled') {
    await env.DB.prepare(
      'UPDATE print_orders SET status=? WHERE id=?'
    ).bind(newStatus, orderId).run();
  }

  const tracking = gelatoData.trackingCode?.[0] || '';
  return jsonRes({
    orderId,
    previousStatus: order.status,
    status: newStatus || order.status,
    gelatoStatus: rawStatus,
    tracking,
    changed: !!(newStatus && newStatus !== order.status && order.status !== 'cancelled'),
  }, 200, request);
}

async function handlePrintWebhook(request, env) {
  if (request.method !== 'POST') return new Response('ok', { status: 200 });
  const payload = await request.json().catch(() => null);
  if (!payload) return new Response('ok', { status: 200 });

  // Gelato webhook format: { event, orderId, orderReferenceId, fulfillmentStatus, items: [{fulfillments: [{trackingCode, trackingUrl}]}] }
  const gelatoOrderId = payload.orderId || payload.orderReferenceId;
  const status = payload.fulfillmentStatus;
  if (!gelatoOrderId || !status) return new Response('ok', { status: 200 });

  // Map Gelato status to our status
  const STATUS_MAP = {
    'created':       'in_production',
    'passed':        'in_production',
    'in_production': 'in_production',
    'printed':       'in_production',
    'shipped':       'shipped',
    'delivered':     'shipped',
    'cancelled':     'cancelled',
    'failed':        'cancelled',
  };
  const newStatus = STATUS_MAP[status.toLowerCase()];
  if (!newStatus) return new Response('ok', { status: 200 });

  await env.DB.prepare(
    'UPDATE print_orders SET status=? WHERE prodigi_order_id=? AND status != ?'
  ).bind(newStatus, gelatoOrderId, 'cancelled').run();

  // Send shipping notification to customer when shipped
  if (newStatus === 'shipped' && env.RESEND_API_KEY) {
    const order = await env.DB.prepare(
      'SELECT * FROM print_orders WHERE prodigi_order_id=?'
    ).bind(gelatoOrderId).first();
    if (order?.customer_email) {
      const fromEmail = env.FROM_EMAIL || 'amit@amitphotos.com';
      const fulfillments = payload.items?.[0]?.fulfillments || [];
      const tracking = fulfillments[0]?.trackingCode || '';
      const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:8px;overflow:hidden">
        <tr><td style="background:#0a0a0a;padding:24px 40px;text-align:center">
          <div style="color:#c8a96e;font-size:20px;font-weight:700;letter-spacing:.25em;font-family:Georgia,serif">AMIT PHOTOS</div>
        </td></tr>
        <tr><td style="padding:32px 40px;color:#222;font-size:15px;line-height:1.85;direction:rtl;text-align:right">
          <h2 style="margin:0 0 1rem">שלום ${order.customer_name}, ההדפסה שלך בדרך! 📦</h2>
          <p><strong>מוצר:</strong> ${order.product_label}</p>
          <p><strong>כתובת:</strong> ${order.address_line1}, ${order.address_city} ${order.address_zip}</p>
          ${tracking ? `<p><strong>מספר מעקב:</strong> ${tracking}</p>` : ''}
          <p style="color:#888;font-size:.9rem">זמן הגעה משוער: 7–10 ימי עסקים.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromEmail, to: order.customer_email, subject: 'ההדפסה שלך נשלחה! — Amit Photos', html })
      });
    }
  }

  return new Response('ok', { status: 200 });
}

async function handlePrintOrders(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { results } = await env.DB.prepare(
    'SELECT * FROM print_orders ORDER BY created_at DESC'
  ).all();
  return jsonRes(results, 200, request);
}

// ===== NEWSLETTER =====
function buildNewsletterHtml(subject, body, unsubscribeUrl, name) {
  const safeBody = body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const safeSubject = subject.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const greeting = name ? `שלום ${name.replace(/&/g,'&amp;')},<br><br>` : '';
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
        <tr><td style="background:#0a0a0a;padding:28px 40px;text-align:center">
          <div style="color:#c8a96e;font-size:22px;font-weight:700;letter-spacing:.25em;font-family:Georgia,serif">AMIT PHOTOS</div>
          <div style="color:#888;font-size:11px;letter-spacing:.18em;margin-top:4px">צילום אמנותי</div>
        </td></tr>
        <tr><td style="padding:36px 40px;color:#222;font-size:15px;line-height:1.85;direction:rtl;text-align:right">
          <h2 style="margin:0 0 1.2rem;font-size:18px;color:#111">${safeSubject}</h2>
          <div style="white-space:pre-wrap">${greeting}${safeBody}</div>
        </td></tr>
        <tr><td style="padding:0 40px"><hr style="border:none;border-top:1px solid #e8e8e8"></td></tr>
        <tr><td style="padding:20px 40px 28px;text-align:center">
          <p style="color:#aaa;font-size:12px;margin:0 0 6px">קיבלת מייל זה כי נרשמת לניוזלטר של <a href="https://amitphotos.com" style="color:#c8a96e;text-decoration:none">amitphotos.com</a></p>
          <p style="margin:0"><a href="${unsubscribeUrl}" style="color:#bbb;font-size:11px;text-decoration:underline">הסר אותי מהרשימה</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function handleNewsletter(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  if (!env.RESEND_API_KEY) return jsonRes({ error: 'RESEND_API_KEY לא מוגדר ב-Cloudflare' }, 500, request);

  const { subject, body } = await request.json().catch(() => ({}));
  if (!subject || !body) return jsonRes({ error: 'נושא ותוכן הם שדות חובה' }, 400, request);

  const { results: subscribers } = await env.DB.prepare('SELECT id, email, name FROM subscribers').all();
  if (!subscribers.length) return jsonRes({ error: 'אין נרשמים ברשימה' }, 400, request);

  const fromEmail = env.FROM_EMAIL || 'amit@amitphotos.com';
  const origin = new URL(request.url).origin;

  const batch = subscribers.map(sub => ({
    from: fromEmail,
    to: sub.email,
    subject,
    html: buildNewsletterHtml(subject, body, `${origin}/api/unsubscribe?token=${sub.id}`, sub.name)
  }));

  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(batch)
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg = errBody.message || errBody.name || `HTTP ${res.status}`;
    return jsonRes({ error: `שגיאת Resend: ${msg}` }, 500, request);
  }

  const data = await res.json().catch(() => ({}));
  const sent = Array.isArray(data.data) ? data.data.length : subscribers.length;
  return jsonRes({ ok: true, sent, total: subscribers.length }, 200, request);
}

// ===== REPLY =====
async function handleReply(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  if (!env.RESEND_API_KEY) return jsonRes({ error: 'RESEND_API_KEY לא מוגדר' }, 500, request);

  const { to, subject, body } = await request.json().catch(() => ({}));
  if (!to || !subject || !body) return jsonRes({ error: 'חסרים שדות' }, 400, request);

  const fromEmail = env.FROM_EMAIL || 'amit@amitphotos.com';
  const safeBody = body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
        <tr><td style="background:#0a0a0a;padding:20px 40px;text-align:center">
          <div style="color:#c8a96e;font-size:18px;font-weight:700;letter-spacing:.22em;font-family:Georgia,serif">AMIT PHOTOS</div>
        </td></tr>
        <tr><td style="padding:32px 40px;color:#222;font-size:15px;line-height:1.85;direction:rtl;text-align:right">
          <div style="white-space:pre-wrap">${safeBody}</div>
        </td></tr>
        <tr><td style="padding:0 40px"><hr style="border:none;border-top:1px solid #e8e8e8"></td></tr>
        <tr><td style="padding:16px 40px 24px;text-align:center">
          <p style="color:#aaa;font-size:12px;margin:0"><a href="https://amitphotos.com" style="color:#c8a96e;text-decoration:none">amitphotos.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromEmail, to, subject, html })
  });
  if (!res.ok) {
    const err = await res.text();
    return jsonRes({ error: `Resend: ${err}` }, 502, request);
  }
  return jsonRes({ ok: true }, 200, request);
}

// ===== UNSUBSCRIBE =====
async function handleUnsubscribe(request, env) {
  const token = new URL(request.url).searchParams.get('token');
  const html = (title, msg, color) => new Response(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f4f4;font-family:Arial,sans-serif">
  <div style="background:#fff;border-radius:8px;padding:48px 40px;max-width:440px;width:100%;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.08)">
    <div style="color:#c8a96e;font-size:18px;font-weight:700;letter-spacing:.22em;font-family:Georgia,serif;margin-bottom:24px">AMIT PHOTOS</div>
    <div style="font-size:2rem;margin-bottom:16px">${color}</div>
    <h2 style="margin:0 0 12px;font-size:20px;color:#111">${title}</h2>
    <p style="color:#666;font-size:14px;line-height:1.7;margin:0 0 24px">${msg}</p>
    <a href="https://amitphotos.com" style="display:inline-block;padding:.6rem 1.6rem;background:#0a0a0a;color:#c8a96e;text-decoration:none;border-radius:4px;font-size:14px">חזרה לאתר</a>
  </div>
</body></html>`, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

  if (!token) return html('קישור לא תקין', 'הקישור להסרה אינו תקין.', '❌');
  const row = await env.DB.prepare('SELECT id FROM subscribers WHERE id=?').bind(token).first().catch(() => null);
  if (!row) return html('כבר הוסרת', 'כתובת המייל שלך אינה ברשימה.', 'ℹ️');
  await env.DB.prepare('DELETE FROM subscribers WHERE id=?').bind(token).run();
  return html('הוסרת בהצלחה', 'הוסרת מרשימת הניוזלטר. לא תקבל עוד מיילים מאיתנו.', '✅');
}

// ===== ANALYTICS =====
async function trackPageView(env, request) {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const country = request.headers.get('CF-IPCountry') || 'XX';
    await env.DB.prepare(
      'INSERT INTO analytics (date, views) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET views = views + 1'
    ).bind(date).run();
    await env.DB.prepare(
      'INSERT INTO analytics_countries (date, country, views) VALUES (?, ?, 1) ON CONFLICT(date, country) DO UPDATE SET views = views + 1'
    ).bind(date, country).run();
  } catch { /* non-critical */ }
}

async function handleAnalytics(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const [{ results: daily }, { results: countries }] = await Promise.all([
    env.DB.prepare('SELECT date, views FROM analytics ORDER BY date DESC LIMIT 30').all(),
    env.DB.prepare(
      'SELECT country, SUM(views) as total FROM analytics_countries WHERE date >= date("now", "-30 days") GROUP BY country ORDER BY total DESC LIMIT 10'
    ).all(),
  ]);
  return jsonRes({ daily, countries }, 200, request);
}

// ===== SERVE PHOTO FROM R2 =====
async function servePhotoPage(photoId, env) {
  // נסה לשלוף תמונה מ-D1
  let photo = null;
  try {
    const row = await env.DB.prepare(
      'SELECT id, title, description, thumbnail, url, category FROM photos WHERE id = ?'
    ).bind(photoId).first();
    if (row) photo = row;
  } catch (_) {}

  // אם לא נמצא ב-D1 — שלוף מ-photos.json
  if (!photo) {
    try {
      const jsonRes = await env.ASSETS.fetch(new Request('https://amitphotos.com/data/photos.json'));
      const photos = await jsonRes.json();
      photo = photos.find(p => p.id === photoId) || null;
    } catch (_) {}
  }

  // תמונות קשורות מאותה קטגוריה
  let relatedPhotos = [];
  if (photo?.category) {
    try {
      const { results } = await env.DB.prepare(
        'SELECT id, title, thumbnail FROM photos WHERE published=1 AND category=? AND id!=? ORDER BY RANDOM() LIMIT 6'
      ).bind(photo.category, photoId).all();
      relatedPhotos = results;
    } catch (_) {}
  }

  const title    = photo?.title       || 'עמית ארז | צילום אמנותי';
  const desc     = photo?.description || 'תמונות אמנותיות דיגיטליות לרכישה — טבע, פורטרט, נופי ישראל ועוד.';
  const category = photo?.category    || '';
  const rawUrl   = photo?.url || photo?.thumbnail || '';
  const imageUrl = rawUrl.startsWith('/') ? `https://amitphotos.com${rawUrl}` : rawUrl || 'https://amitphotos.com/assets/images/og-default.jpg';
  const pageUrl  = `https://amitphotos.com/photo/${photoId}`;

  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ImageObject",
    "name": title,
    "description": desc,
    "contentUrl": imageUrl,
    "url": pageUrl,
    "creator": { "@type": "Person", "name": "עמית ארז", "url": "https://amitphotos.com" },
    ...(category ? { "about": category } : {}),
  });

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} | עמית ארז צילום</title>
  <meta name="description" content="${desc}" />
  <meta property="og:site_name" content="עמית ארז צילום" />
  <meta property="og:title" content="${title} | עמית ארז" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:image:alt" content="${title}" />
  <meta property="og:locale" content="he_IL" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@amite" />
  <meta name="twitter:title" content="${title} | עמית ארז" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="${imageUrl}" />
  <meta name="twitter:image:alt" content="${title}" />
  <link rel="canonical" href="${pageUrl}" />
  <script type="application/ld+json">${schema}</script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0a0a0a;color:#f0f0f0;font-family:'Heebo',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:2rem 1rem}
    a{color:#c9a96e;text-decoration:none}
    a:hover{text-decoration:underline}
    .back{align-self:flex-start;margin-bottom:1.5rem;font-size:.9rem;opacity:.8}
    .photo-wrap{max-width:900px;width:100%}
    img{width:100%;height:auto;border-radius:8px;display:block}
    .info{max-width:900px;width:100%;margin-top:1.5rem}
    h1{font-size:1.6rem;font-weight:600;margin-bottom:.5rem}
    .category{font-size:.9rem;opacity:.6;margin-bottom:.75rem}
    .desc{font-size:1rem;line-height:1.7;opacity:.85;margin-bottom:1.5rem}
    .buy{display:inline-block;background:#c9a96e;color:#0a0a0a;padding:.7rem 1.8rem;border-radius:4px;font-weight:600;font-size:1rem}
    .buy:hover{background:#e0c080;text-decoration:none}
    .cat-link{color:#c9a96e;font-size:.9rem}
    .cat-link:hover{text-decoration:underline}
    .related{max-width:900px;width:100%;margin-top:3rem}
    .related h2{font-size:1.1rem;margin-bottom:1rem;opacity:.7}
    .rel-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    .rel-grid a img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:4px;display:block;transition:opacity .2s}
    .rel-grid a img:hover{opacity:.8}
    .credit{margin-top:3rem;font-size:.8rem;opacity:.4}
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600&display=swap" rel="stylesheet">
</head>
<body>
  <a class="back" href="https://amitphotos.com">← חזרה לגלריה</a>
  <div class="photo-wrap">
    <img src="${imageUrl}" alt="${title}" loading="lazy" />
  </div>
  <div class="info">
    <h1>${title}</h1>
    ${category ? `<p class="category"><a href="https://amitphotos.com/category/${encodeURIComponent(category)}" class="cat-link">← כל תמונות ${category}</a></p>` : ''}
    ${desc ? `<p class="desc">${desc}</p>` : ''}
    <a class="buy" href="https://amitphotos.com/#photo-${photoId}">לרכישת התמונה</a>
  </div>
  ${relatedPhotos.length ? `
  <div class="related">
    <h2>תמונות נוספות מ${category}</h2>
    <div class="rel-grid">
      ${relatedPhotos.map(r => {
        const rImg = (r.thumbnail||'').startsWith('/') ? `https://amitphotos.com${r.thumbnail}` : r.thumbnail||'';
        return `<a href="https://amitphotos.com/photo/${r.id}"><img src="${rImg}" alt="${r.title||''}" loading="lazy" /></a>`;
      }).join('')}
    </div>
  </div>` : ''}
  <p class="credit">© עמית ארז — amitphotos.com</p>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

// ===== CATEGORY PAGE =====
async function handleCategoryPage(category, env) {
  if (!category) return Response.redirect('https://amitphotos.com', 302);

  let photos = [];
  try {
    const { results } = await env.DB.prepare(
      'SELECT id, title, description, thumbnail, url FROM photos WHERE published=1 AND category=? ORDER BY sort_order ASC, created_at DESC LIMIT 200'
    ).bind(category).all();
    photos = results;
  } catch (_) {}

  if (!photos.length) return Response.redirect('https://amitphotos.com', 302);

  const base = 'https://amitphotos.com';
  const pageUrl = `${base}/category/${encodeURIComponent(category)}`;
  const pageTitle = `צילומי ${category} | עמית ארז`;
  const pageDesc = `${photos.length} תמונות צילום מ${category} מאת הצלם עמית ארז. כל התמונות זמינות לרכישה ולהורדה דיגיטלית.`;
  const ogImage = photos[0]?.thumbnail?.startsWith('/') ? `${base}${photos[0].thumbnail}` : photos[0]?.thumbnail || '';

  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": pageTitle,
    "description": pageDesc,
    "url": pageUrl,
    "numberOfItems": photos.length,
    "creator": { "@type": "Person", "name": "עמית ארז", "url": base },
    "hasPart": photos.slice(0, 10).map(p => ({
      "@type": "ImageObject",
      "name": p.title || category,
      "url": `${base}/photo/${p.id}`,
      "contentUrl": p.thumbnail?.startsWith('/') ? `${base}${p.thumbnail}` : p.thumbnail,
    })),
  });

  const cards = photos.map(p => {
    const img = p.thumbnail?.startsWith('/') ? `${base}${p.thumbnail}` : p.thumbnail || '';
    const title = p.title || category;
    return `<a href="${base}/photo/${p.id}" class="card">
      <img src="${img}" alt="${escXml(title)}" loading="lazy" />
      <span>${escXml(title)}</span>
    </a>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${pageTitle}</title>
  <meta name="description" content="${pageDesc}" />
  <meta property="og:site_name" content="עמית ארז צילום" />
  <meta property="og:title" content="${pageTitle}" />
  <meta property="og:description" content="${pageDesc}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${pageUrl}" />
  ${ogImage ? `<meta property="og:image" content="${ogImage}" /><meta property="og:image:alt" content="${escXml(category)}" />` : ''}
  <meta property="og:locale" content="he_IL" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${pageTitle}" />
  <meta name="twitter:description" content="${pageDesc}" />
  ${ogImage ? `<meta name="twitter:image" content="${ogImage}" />` : ''}
  <link rel="canonical" href="${pageUrl}" />
  <script type="application/ld+json">${schema}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0a0a0a;color:#f0f0f0;font-family:'Heebo',sans-serif;padding:2rem 1rem}
    a{color:inherit;text-decoration:none}
    .back{display:inline-block;color:#c9a96e;margin-bottom:2rem;font-size:.9rem}
    .back:hover{text-decoration:underline}
    h1{font-size:2rem;font-weight:600;margin-bottom:.4rem}
    .sub{opacity:.5;font-size:.9rem;margin-bottom:2rem}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
    .card{display:flex;flex-direction:column;border-radius:6px;overflow:hidden;background:#1a1a1a;transition:transform .2s}
    .card:hover{transform:translateY(-3px)}
    .card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}
    .card span{padding:.6rem .8rem;font-size:.8rem;opacity:.8}
    .footer{margin-top:3rem;text-align:center}
    .btn{display:inline-block;background:#c9a96e;color:#0a0a0a;padding:.7rem 2rem;border-radius:4px;font-weight:600}
    .btn:hover{background:#e0c080}
  </style>
</head>
<body>
  <a class="back" href="${base}">← עמית ארז | גלריה</a>
  <h1>צילומי ${escXml(category)}</h1>
  <p class="sub">${photos.length} תמונות · צלם: עמית ארז</p>
  <div class="grid">${cards}</div>
  <div class="footer">
    <a class="btn" href="${base}">לכל הגלריה</a>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'public, max-age=1800' },
  });
}

async function servePhoto(key, env, request) {
  const url = new URL(request.url);
  const w = parseInt(url.searchParams.get('w')) || 0;

  // Cloudflare Image Resizing — gracefully degrades if not enabled on the account
  if (w && !request.headers.get('x-no-resize')) {
    try {
      const origin = url.origin;
      const resized = await fetch(`${origin}/photos/${key}`, {
        cf: { image: { width: w, quality: 75, format: 'webp' } },
        headers: { 'x-no-resize': '1' },
      });
      if (resized.ok) {
        const headers = new Headers(resized.headers);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('Access-Control-Allow-Origin', '*');
        return new Response(resized.body, { headers });
      }
    } catch (_) {}
  }

  const object = await env.PHOTOS.get(key);
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function handleImageProxy(request, env) {
  const urlParam = new URL(request.url).searchParams.get('url');
  if (!urlParam) return new Response('url missing', { status: 400 });
  let urlObj;
  try { urlObj = new URL(urlParam); } catch { return new Response('invalid url', { status: 400 }); }
  const allowedHosts = ['drive.google.com', 'lh3.googleusercontent.com', 'googleusercontent.com'];
  const host = urlObj.hostname;
  const sameOrigin = urlParam.startsWith(new URL(request.url).origin);
  if (!sameOrigin && !allowedHosts.some(h => host === h || host.endsWith('.' + h))) {
    return new Response('domain not allowed', { status: 403 });
  }
  const res = await fetch(urlParam);
  if (!res.ok) return new Response('fetch failed', { status: res.status });
  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'image/jpeg',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

async function handlePrintUploadCrop(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  const body = await request.arrayBuffer().catch(() => null);
  if (!body || !body.byteLength) return jsonRes({ error: 'גוף ריק' }, 400, request);
  const key = `crop-${crypto.randomUUID()}.jpg`;
  await env.PHOTOS.put(key, body, { httpMetadata: { contentType: 'image/jpeg' } });
  const origin = new URL(request.url).origin;
  return jsonRes({ url: `${origin}/photos/${key}` }, 200, request);
}

// ===== SITEMAP =====
async function handleSitemap(request, env) {
  const base = 'https://amitphotos.com';
  function absUrl(u) {
    if (!u) return '';
    return u.startsWith('http') ? u : `${base}${u.startsWith('/') ? '' : '/'}${u}`;
  }
  const now = new Date().toISOString().split('T')[0];
  function toDate(str) {
    if (!str) return now;
    const d = new Date(str);
    return isNaN(d.getTime()) ? now : d.toISOString().split('T')[0];
  }

  // דפים סטטיים — ללא hash URLs (Google מתעלם מהם)
  const staticPages = [
    { loc: '/', priority: '1.0', changefreq: 'weekly' },
  ];

  // דפי קטגוריה
  let categoryUrls = [];
  try {
    const { results: cats } = await env.DB.prepare(
      'SELECT DISTINCT category, MAX(created_at) as last FROM photos WHERE published=1 AND category!=? GROUP BY category'
    ).bind('').all();
    categoryUrls = cats.map(c => `  <url>
    <loc>${base}/category/${escXml(encodeURIComponent(c.category))}</loc>
    <lastmod>${toDate(c.last)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`);
  } catch (_) {}

  // תמונות מ-D1
  let photoUrls = [];
  try {
    const { results } = await env.DB.prepare(
      'SELECT id, title, thumbnail, category, created_at FROM photos WHERE published=1 ORDER BY created_at DESC LIMIT 1000'
    ).all();

    photoUrls = results.map(p => {
      const lastmod = toDate(p.created_at);
      const imageTag = p.thumbnail ? `
    <image:image>
      <image:loc>${escXml(absUrl(p.thumbnail))}</image:loc>
      <image:title>${escXml(p.title || '')}</image:title>
      <image:caption>${escXml(p.category || '')}</image:caption>
    </image:image>` : '';
      return `  <url>
    <loc>${base}/photo/${escXml(p.id)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>${imageTag}
  </url>`;
    });
  } catch { /* DB לא זמין — sitemap ללא תמונות */ }

  const staticXml = staticPages.map(p => `  <url>
    <loc>${base}${p.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${staticXml}
${categoryUrls.join('\n')}
${photoUrls.join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=UTF-8',
      'Cache-Control': 'public, max-age=900, s-maxage=0',  // edge: no cache; browser: 15min
    },
  });
}

function escXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ===== ROBOTS.TXT =====
function handleRobots(request) {
  const base = 'https://amitphotos.com';
  const txt = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin

Sitemap: ${base}/sitemap.xml`;

  return new Response(txt, {
    headers: {
      'Content-Type': 'text/plain; charset=UTF-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

// ===== NEW BADGE SETTINGS =====
async function getNewBadgeDays(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'new_badge_days'").first();
  return parseInt(row?.value || '7', 10);
}

async function handleNewBadgeSettings(request, env) {
  if (request.method === 'GET') {
    const days = await getNewBadgeDays(env);
    return jsonRes({ days }, 200, request);
  }
  if (request.method === 'POST') {
    if (!await checkAuth(request, env)) return unauth(request);
    const { days } = await request.json().catch(() => ({}));
    if (!days || isNaN(days) || days < 1) return jsonRes({ error: 'invalid days' }, 400, request);
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('new_badge_days', ?)").bind(String(days)).run();
    return jsonRes({ ok: true, days }, 200, request);
  }
  return jsonRes({ error: 'method not allowed' }, 405, request);
}

async function getGlobalPrices(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key='prices'").first();
  if (row?.value) {
    try { return JSON.parse(row.value); } catch {}
  }
  return { small: 19, medium: 59, large: 129 };
}

async function handlePhotoOfWeekSuggest(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { results } = await env.DB.prepare(`
    SELECT p.id, p.title, p.thumbnail,
           COUNT(t.token) as purchase_count
    FROM photos p
    LEFT JOIN download_tokens t ON json_extract(t.photo_ids, '$[0]') = p.id
    WHERE p.published = 1
    GROUP BY p.id
    ORDER BY purchase_count ASC
  `).all();
  if (!results.length) return jsonRes({ error: 'אין תמונות זמינות' }, 404, request);
  const bottomCount = Math.max(1, Math.floor(results.length * 0.2));
  const candidates = results.slice(0, bottomCount);
  const photo = candidates[Math.floor(Math.random() * candidates.length)];
  return jsonRes({ photo: { id: photo.id, title: photo.title, thumbnail: photo.thumbnail } }, 200, request);
}

async function handlePhotoOfWeekSet(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { photo_id } = await request.json().catch(() => ({}));
  if (!photo_id) return jsonRes({ error: 'photo_id required' }, 400, request);
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('photo_of_week_id', ?)").bind(photo_id).run();
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('photo_of_week_discount', '0.25')").run();
  await env.DB.prepare("DELETE FROM settings WHERE key IN ('photo_of_week_caption','photo_of_week_caption_en')").run();
  dispatchWorkflow('week-photo-social.yml', env);
  return jsonRes({ ok: true }, 200, request);
}

async function handlePhotoOfWeekClear(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  await env.DB.prepare("DELETE FROM settings WHERE key IN ('photo_of_week_id','photo_of_week_caption','photo_of_week_caption_en')").run();
  return jsonRes({ ok: true }, 200, request);
}

async function handlePhotoOfWeekCaption(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const bearerValid = env.ADMIN_PASSWORD && authHeader === `Bearer ${env.ADMIN_PASSWORD}`;
  if (!bearerValid && !await checkAuth(request, env)) return unauth(request);
  const { caption, caption_en } = await request.json().catch(() => ({}));
  if (!caption) return jsonRes({ error: 'caption required' }, 400, request);
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('photo_of_week_caption', ?)").bind(caption).run();
  if (caption_en) await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('photo_of_week_caption_en', ?)").bind(caption_en).run();
  return jsonRes({ ok: true }, 200, request);
}

async function handleAdminPrices(request, env) {
  if (request.method === 'GET') {
    const prices = await getGlobalPrices(env);
    return jsonRes(prices, 200, request);
  }
  if (request.method === 'POST') {
    if (!await checkAuth(request, env)) return unauth(request);
    const body = await request.json().catch(() => ({}));
    const { small, medium, large } = body;
    if ([small, medium, large].some(v => isNaN(parseFloat(v)) || parseFloat(v) < 0))
      return jsonRes({ error: 'מחיר לא תקין' }, 400, request);
    const prices = { small: parseFloat(small), medium: parseFloat(medium), large: parseFloat(large) };
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('prices', ?)").bind(JSON.stringify(prices)).run();
    return jsonRes({ ok: true, prices }, 200, request);
  }
  return jsonRes({ error: 'method not allowed' }, 405, request);
}

async function handlePhotosReorder(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const orders = await request.json().catch(() => null);
  if (!Array.isArray(orders)) return jsonRes({ error: 'expected array [{id, sort_order}]' }, 400, request);
  for (const { id, sort_order } of orders) {
    await env.DB.prepare('UPDATE photos SET sort_order=? WHERE id=?').bind(sort_order, id).run();
  }
  return jsonRes({ ok: true, updated: orders.length }, 200, request);
}

async function handleAdminPhotoPrice(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { photo_id, price_override } = await request.json().catch(() => ({}));
  if (!photo_id) return jsonRes({ error: 'photo_id required' }, 400, request);
  // price_override is JSON object {small, medium, large} or null
  const val = price_override === null ? null : JSON.stringify(price_override);
  await env.DB.prepare("UPDATE photos SET price_overrides = ? WHERE id = ?").bind(val, photo_id).run();
  return jsonRes({ ok: true }, 200, request);
}

async function handleAdminPhotoDimensions(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { updates } = await request.json().catch(() => ({}));
  if (!Array.isArray(updates) || !updates.length) return jsonRes({ error: 'updates array required' }, 400, request);
  const stmt = env.DB.prepare('UPDATE photos SET width=?, height=? WHERE id=?');
  await env.DB.batch(updates.map(({ id, width, height }) => stmt.bind(width, height, id)));
  return jsonRes({ ok: true, updated: updates.length }, 200, request);
}

async function handleAdminReplacePhoto(request, env, photoId) {
  if (!await checkAuth(request, env)) return unauth(request);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return jsonRes({ error: 'empty body' }, 400, request);
  const url = new URL(request.url);
  const width  = parseInt(url.searchParams.get('width')  || '0');
  const height = parseInt(url.searchParams.get('height') || '0');
  await env.BUCKET.put(`${photoId}.jpg`, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  if (width && height) {
    await env.DB.prepare('UPDATE photos SET width=?, height=? WHERE id=?').bind(width, height, photoId).run();
  }
  return jsonRes({ ok: true }, 200, request);
}

async function handleUploadStory(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return jsonRes({ error: 'empty body' }, 400, request);
  await env.BUCKET.put('story/latest.jpg', bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  const url = `${new URL(request.url).origin}/photos/story/latest.jpg`;
  return jsonRes({ url }, 200, request);
}

async function handleAdminFeatured(request, env) {
  if (request.method === 'GET') {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key='featured_ids'").first();
    const ids = row?.value ? JSON.parse(row.value).filter(Boolean) : [];
    return jsonRes({ ids }, 200, request);
  }
  if (request.method === 'POST') {
    if (!await checkAuth(request, env)) return unauth(request);
    const { ids } = await request.json().catch(() => ({}));
    if (!Array.isArray(ids)) return jsonRes({ error: 'ids array required' }, 400, request);
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('featured_ids', ?)").bind(JSON.stringify(ids)).run();
    return jsonRes({ ok: true }, 200, request);
  }
  return jsonRes({ error: 'method not allowed' }, 405, request);
}

async function handlePricesPage(request, env) {
  const prices = await getGlobalPrices(env);
  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>מחירים — עמית צילום</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;600;700&family=Syne:wght@700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#f0ede8;font-family:'Heebo',sans-serif;direction:rtl;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem 1rem}
h1{font-family:'Syne',sans-serif;font-size:2rem;color:#c8a96e;margin-bottom:.5rem;text-align:center}
.subtitle{color:#888;margin-bottom:3rem;text-align:center;font-size:.95rem}
.cards{display:flex;gap:1.5rem;flex-wrap:wrap;justify-content:center;max-width:700px;width:100%}
.card{background:#111;border:1px solid #222;border-radius:8px;padding:2rem 1.5rem;flex:1;min-width:180px;max-width:200px;text-align:center;transition:border-color .25s}
.card:hover{border-color:#c8a96e}
.card-label{font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:#888;margin-bottom:.75rem}
.card-size{font-family:'Syne',sans-serif;font-size:1.6rem;color:#fff;margin-bottom:.25rem}
.card-dims{font-size:.75rem;color:#666;margin-bottom:1.25rem}
.card-price{font-size:2rem;font-weight:700;color:#c8a96e}
.card-mp{font-size:.72rem;color:#666;margin-top:.3rem}
.note{margin-top:2.5rem;color:#555;font-size:.8rem;text-align:center;max-width:480px;line-height:1.6}
a.back{display:inline-flex;align-items:center;gap:.4rem;margin-top:2rem;color:#888;font-size:.85rem;text-decoration:none;transition:color .2s}
a.back:hover{color:#c8a96e}
</style>
</head>
<body>
<h1>מחירי הורדה</h1>
<p class="subtitle">קבצים דיגיטליים באיכות גבוהה — הורדה מיידית לאחר תשלום</p>
<div class="cards">
  <div class="card">
    <div class="card-label">S</div>
    <div class="card-size">קטן</div>
    <div class="card-dims">2000×1333 פיקסל</div>
    <div class="card-price">₪${prices.small}</div>
    <div class="card-mp">~6MP · הדפסה עד 10×15 ס"מ</div>
  </div>
  <div class="card">
    <div class="card-label">M</div>
    <div class="card-size">בינוני</div>
    <div class="card-dims">4000×2667 פיקסל</div>
    <div class="card-price">₪${prices.medium}</div>
    <div class="card-mp">~24MP · הדפסה 21×30 ס"מ</div>
  </div>
  <div class="card">
    <div class="card-label">L</div>
    <div class="card-size">גדול</div>
    <div class="card-dims">6000×4000 פיקסל</div>
    <div class="card-price">₪${prices.large}</div>
    <div class="card-mp">~54MP · A2 ומעלה</div>
  </div>
</div>
<p class="note">כל התמונות נמכרות לשימוש אישי בלבד. לשימוש מסחרי — <a href="/#contact" style="color:#c8a96e">צרו קשר</a>.</p>
<a class="back" href="/">← חזרה לגלריה</a>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function handleTogglePhotoNew(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { photo_id, is_new, title, category, url, thumbnail } = await request.json().catch(() => ({}));
  if (!photo_id) return jsonRes({ error: 'photo_id required' }, 400, request);
  const result = await env.DB.prepare("UPDATE photos SET is_new = ? WHERE id = ?").bind(is_new ? 1 : 0, photo_id).run();
  if ((result.meta?.changes ?? result.changes ?? 0) === 0 && is_new) {
    // Drive photo not yet in D1 — insert minimal record
    await env.DB.prepare(
      "INSERT OR IGNORE INTO photos (id, title, category, url, thumbnail, is_new, published, created_at) VALUES (?,?,?,?,?,1,1,datetime('now'))"
    ).bind(photo_id, title||'', category||'', url||'', thumbnail||'').run();
  }
  return jsonRes({ ok: true }, 200, request);
}

// ===== ADMIN PURCHASES =====
async function handleAdminPurchases(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const url = new URL(request.url);
  const filter = url.searchParams.get('filter') || 'all';
  const now = Math.floor(Date.now() / 1000);

  let whereClauses = [];
  if (filter === 'active')  whereClauses.push(`t.used = 0 AND t.expires_at > ${now}`);
  if (filter === 'used')    whereClauses.push(`t.used = 1`);
  if (filter === 'expired') whereClauses.push(`t.used = 0 AND t.expires_at <= ${now}`);
  const where = whereClauses.length ? `WHERE ${whereClauses[0]}` : '';

  const rows = await env.DB.prepare(`
    SELECT t.token, t.photo_ids, t.size, t.tx, t.used, t.expires_at, t.created_at,
           COALESCE(t.amount, 0) as amount,
           p.title
    FROM download_tokens t
    LEFT JOIN photos p ON json_extract(t.photo_ids, '$[0]') = p.id
    ${where}
    ORDER BY t.created_at DESC
    LIMIT 200
  `).all();

  const stats = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(amount), 0) as total_revenue,
      COUNT(*) as total_purchases,
      SUM(CASE WHEN created_at >= ${now - 30*86400} THEN 1 ELSE 0 END) as this_month,
      COALESCE(SUM(CASE WHEN size='small' THEN amount ELSE 0 END), 0) as rev_small,
      COALESCE(SUM(CASE WHEN size='medium' THEN amount ELSE 0 END), 0) as rev_medium,
      COALESCE(SUM(CASE WHEN size='large' THEN amount ELSE 0 END), 0) as rev_large
    FROM download_tokens
  `).first();

  const topPhotos = await env.DB.prepare(`
    SELECT p.title, COUNT(*) as cnt, COALESCE(SUM(t.amount), 0) as revenue
    FROM download_tokens t
    LEFT JOIN photos p ON json_extract(t.photo_ids, '$[0]') = p.id
    WHERE p.title IS NOT NULL
    GROUP BY json_extract(t.photo_ids, '$[0]')
    ORDER BY cnt DESC
    LIMIT 5
  `).all();

  const dailyRev = await env.DB.prepare(`
    SELECT
      strftime('%Y-%m-%d', datetime(created_at, 'unixepoch')) as day,
      COALESCE(SUM(amount), 0) as revenue
    FROM download_tokens
    WHERE created_at >= ${now - 30*86400}
    GROUP BY day
    ORDER BY day ASC
  `).all();

  return jsonRes({
    tokens: rows.results,
    stats: { ...stats, top_photos: topPhotos.results, daily_revenue: dailyRev.results }
  }, 200, request);
}

async function handleAdminCreateToken(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { photo_id, size } = await request.json().catch(() => ({}));
  if (!photo_id || !size) return jsonRes({ error: 'photo_id and size required' }, 400, request);
  const VALID_SIZES = ['small', 'medium', 'large'];
  if (!VALID_SIZES.includes(size)) return jsonRes({ error: 'invalid size' }, 400, request);

  const now = Math.floor(Date.now() / 1000);
  const expires = now + 30 * 86400;
  const token = crypto.randomUUID();

  await env.DB.prepare(
    'INSERT INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at, amount) VALUES (?, ?, ?, ?, 0, ?, ?, 0)'
  ).bind(token, JSON.stringify([photo_id]), size, `MANUAL_${token.slice(0,8)}`, expires, now).run();

  const origin = new URL(request.url).origin;
  return jsonRes({ token, url: `${origin}/api/download/${token}` }, 200, request);
}

async function handleMigrateAnalyses(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS photo_analyses (
        photo_id TEXT PRIMARY KEY,
        composition_rule TEXT NOT NULL,
        annotations_json TEXT NOT NULL DEFAULT '[]',
        camera_json TEXT NOT NULL DEFAULT '{}',
        composition_html TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        title TEXT NOT NULL DEFAULT '',
        published_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
    return jsonRes({ ok: true, message: 'photo_analyses table ready' }, 200, request);
  } catch (e) {
    return jsonRes({ error: String(e) }, 500, request);
  }
}

async function handleAnalysesList(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  try {
    const { results } = await env.DB.prepare(
      `SELECT a.photo_id, a.title, a.composition_rule, a.published_at,
              p.thumbnail
       FROM photo_analyses a
       LEFT JOIN photos p ON p.id = a.photo_id
       ORDER BY a.published_at DESC`
    ).all();
    return jsonRes(results || [], 200, request);
  } catch (e) {
    return jsonRes({ error: String(e) }, 500, request);
  }
}

async function handleAnalysesGet(request, env, photoId) {
  if (!await checkAuth(request, env)) return unauth(request);
  try {
    const row = await env.DB.prepare(
      'SELECT * FROM photo_analyses WHERE photo_id = ?'
    ).bind(photoId).first();
    if (!row) return jsonRes({ error: 'לא נמצא' }, 404, request);
    return jsonRes({
      ...row,
      annotations: JSON.parse(row.annotations_json || '[]'),
      camera: JSON.parse(row.camera_json || '{}'),
      tags: JSON.parse(row.tags_json || '[]'),
    }, 200, request);
  } catch (e) {
    return jsonRes({ error: String(e) }, 500, request);
  }
}

async function handleAnalysesUpdate(request, env, photoId) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'PUT') return jsonRes({ error: 'PUT only' }, 405, request);
  const body = await request.json().catch(() => ({}));
  const fields = [];
  const values = [];
  if (body.composition_html !== undefined) { fields.push('composition_html = ?'); values.push(body.composition_html); }
  if (body.tags_json !== undefined)        { fields.push('tags_json = ?');        values.push(body.tags_json); }
  if (body.camera_json !== undefined)      { fields.push('camera_json = ?');      values.push(body.camera_json); }
  if (body.annotations_json !== undefined) { fields.push('annotations_json = ?'); values.push(body.annotations_json); }
  if (body.title !== undefined)            { fields.push('title = ?');            values.push(body.title); }
  if (!fields.length) return jsonRes({ error: 'אין שדות לעדכון' }, 400, request);
  values.push(photoId);
  await env.DB.prepare(`UPDATE photo_analyses SET ${fields.join(', ')} WHERE photo_id = ?`).bind(...values).run();
  return jsonRes({ ok: true }, 200, request);
}

async function handleAnalysesGenerate(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: 'ANTHROPIC_API_KEY חסר' }, 500, request);

  // 1. Pick 5 candidates (unanalyzed, have EXIF, published)
  const { results: candidates } = await env.DB.prepare(`
    SELECT p.id, p.title, p.thumbnail, p.url, p.exif, p.description
    FROM photos p
    LEFT JOIN photo_analyses a ON a.photo_id = p.id
    WHERE a.photo_id IS NULL
      AND p.exif IS NOT NULL
      AND p.published = 1
    ORDER BY RANDOM()
    LIMIT 5
  `).all();

  if (!candidates || candidates.length === 0) {
    return jsonRes({ error: 'אין תמונות זמינות לניתוח' }, 404, request);
  }

  // 2. Ask Claude haiku to pick the best photo for educational analysis
  const pickContent = [
    {
      type: 'text',
      text: `אתה מורה לצילום. מוצגות לך ${candidates.length} תמונות. בחר אחת שמדגימה חוק צילום בצורה הכי ברורה לצלמן מתחיל.

חוקים אפשריים: rule_of_thirds, symmetry, leading_lines, golden_ratio, framing, negative_space

החזר JSON בלבד (ללא markdown):
{"index": 0-${candidates.length - 1}, "rule": "שם_החוק", "reason": "משפט אחד בעברית"}`
    },
    ...candidates.map((c, i) => ({
      type: 'image',
      source: { type: 'url', url: c.thumbnail || c.url }
    }))
  ];

  const pickRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: pickContent }]
    })
  });
  if (!pickRes.ok) return jsonRes({ error: 'Claude API error (pick)' }, 502, request);

  let pickData;
  try {
    const pickJson = await pickRes.json();
    const raw = pickJson.content?.[0]?.text?.trim() || '{}';
    pickData = JSON.parse(raw.replace(/```json\n?|\n?```/g, ''));
  } catch {
    pickData = { index: 0, rule: 'rule_of_thirds' };
  }

  const chosen = candidates[pickData.index] || candidates[0];
  const rule = pickData.rule || 'rule_of_thirds';
  const exif = JSON.parse(chosen.exif || '{}');
  const focalVal = exif.focal || '?';
  const apertureVal = exif.aperture || '?';
  const shutterVal = exif.shutter ? `1/${Math.round(1 / exif.shutter)}` : '?';
  const isoVal = exif.iso || '?';
  const cameraVal = exif.camera || '';

  // 3. Ask Claude sonnet for full analysis
  const analysisRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: chosen.thumbnail || chosen.url } },
          { type: 'text', text: `אתה מורה לצילום כותב מדריך לצלמן מתחיל על התמונה הזו.

נתוני מצלמה:
- כותרת: ${chosen.title || ''}
- תיאור: ${chosen.description || ''}
- מצלמה: ${cameraVal}
- מרחק מוקד: ${focalVal}mm
- צמצם: f/${apertureVal}
- תריס: ${shutterVal}s
- ISO: ${isoVal}
- חוק צילום לנתח: ${rule}

החזר JSON בלבד (ללא markdown), בדיוק במבנה הזה:
{
  "annotations": [
    {"x_pct": 0-100, "y_pct": 0-100, "label": "שורה1\\nשורה2", "anchor": "left|right|top|bottom"}
  ],
  "camera_analysis": {
    "aperture": {"value": "f/${apertureVal}", "explanation": "הסבר קצר בעברית"},
    "shutter":  {"value": "${shutterVal}s",   "explanation": "הסבר קצר בעברית"},
    "iso":      {"value": "${isoVal}",        "explanation": "הסבר קצר בעברית"},
    "focal":    {"value": "${focalVal}mm",    "explanation": "הסבר קצר בעברית"}
  },
  "composition_html": "<p><strong>כותרת:</strong> טקסט ראשון...</p><p><strong>כותרת:</strong> טקסט שני...</p><p><strong>כותרת:</strong> טקסט שלישי...</p>",
  "tags": ["תג1", "תג2", "תג3", "תג4"]
}

חוקים:
- annotations: 3-5 נקודות, בפיזור על התמונה
- composition_html: בדיוק 3 פסקאות עם <strong> בתחילת כל אחת
- tags: 4-6 מילים קצרות בעברית
- הכל בעברית` }
        ]
      }]
    })
  });
  if (!analysisRes.ok) return jsonRes({ error: 'Claude API error (analysis)' }, 502, request);

  let analysis;
  try {
    const analysisJson = await analysisRes.json();
    const raw = analysisJson.content?.[0]?.text?.trim() || '{}';
    analysis = JSON.parse(raw.replace(/```json\n?|\n?```/g, ''));
  } catch (e) {
    return jsonRes({ error: 'Failed to parse Claude response: ' + String(e) }, 502, request);
  }

  // 4. Save to D1
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT OR REPLACE INTO photo_analyses
      (photo_id, composition_rule, annotations_json, camera_json, composition_html, tags_json, title, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    chosen.id,
    rule,
    JSON.stringify(analysis.annotations || []),
    JSON.stringify(analysis.camera_analysis || {}),
    analysis.composition_html || '',
    JSON.stringify(analysis.tags || []),
    chosen.title || '',
    now
  ).run();

  // 5. Return for social posting
  return jsonRes({
    ok: true,
    photo_id: chosen.id,
    title: chosen.title,
    thumbnail: chosen.thumbnail || chosen.url,
    composition_rule: rule,
    tags: analysis.tags || [],
    composition_html: analysis.composition_html || '',
    learn_url: `https://amitphotos.com/learn/${chosen.id}`,
  }, 200, request);
}

// ===== LEARN INDEX =====
const RULE_LABELS = {
  rule_of_thirds: 'חוק השליש',
  symmetry: 'סימטריה',
  leading_lines: 'קווים מובילים',
  golden_ratio: 'יחס הזהב',
  framing: 'מסגור',
  negative_space: 'מרחב שלילי',
};

async function handleLearnIndex(env) {
  const { results: analyses } = await env.DB.prepare(
    `SELECT a.photo_id, a.title, a.composition_rule, a.tags_json, a.published_at,
            p.thumbnail
     FROM photo_analyses a
     LEFT JOIN photos p ON p.id = a.photo_id
     ORDER BY a.published_at DESC`
  ).all().catch(() => ({ results: [] }));

  const cards = (analyses || []).map(a => {
    const thumb = a.thumbnail || '';
    const ruleLabel = RULE_LABELS[a.composition_rule] || a.composition_rule;
    const tags = JSON.parse(a.tags_json || '[]').slice(0, 3).map(t => `<span class="tag">${escXml(t)}</span>`).join('');
    const date = a.published_at ? a.published_at.slice(0, 10) : '';
    return `<a class="learn-card" href="/learn/${escXml(a.photo_id)}">
      <img src="${escXml(thumb)}" alt="${escXml(a.title)}" loading="lazy">
      <div class="learn-card-body">
        <div class="learn-card-rule">${escXml(ruleLabel)}</div>
        <div class="learn-card-title">${escXml(a.title)}</div>
        <div class="learn-card-tags">${tags}</div>
        <div class="learn-card-date">${escXml(date)}</div>
      </div>
    </a>`;
  }).join('\n');

  const empty = analyses.length === 0
    ? '<p style="text-align:center;color:#888;padding:4rem">הניתוח הראשון יפורסם בקרוב — חזרו מחר!</p>'
    : '';

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>בית ספר לצילום — Amit Photos</title>
<meta name="description" content="ניתוח צילומי מעמיק של תמונות אמנות — חוק השליש, בוקה, קומפוזיציה. מדריך לצלמן מתחיל.">
<meta property="og:title" content="📸 בית ספר לצילום | Amit Photos">
<meta property="og:description" content="ניתוח צילומי מעמיק — חוקי קומפוזיציה, הגדרות מצלמה, ופירוש כל בחירה של הצלם.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://amitphotos.com/learn/">
<meta property="og:locale" content="he_IL">
<link rel="canonical" href="https://amitphotos.com/learn/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&family=Syne:wght@700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a0a;--surface:#111;--border:#222;--accent:#c8a96e;--text:#f0ede8;--muted:#888}
body{font-family:'Heebo',sans-serif;background:var(--bg);color:var(--text);direction:rtl;min-height:100vh;padding:0 0 4rem}
.site-header{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid var(--border)}
.site-title{font-family:'Syne',sans-serif;font-size:1.1rem;color:var(--accent);text-decoration:none}
.page-hero{text-align:center;padding:2.5rem 1.25rem 1.5rem}
.page-hero h1{font-family:'Syne',sans-serif;font-size:1.8rem;color:var(--accent);margin-bottom:.5rem}
.page-hero p{color:var(--muted);font-size:.9rem;max-width:380px;margin:0 auto}
.grid{display:grid;grid-template-columns:1fr;gap:1rem;padding:1.25rem;max-width:900px;margin:0 auto}
@media(min-width:520px){.grid{grid-template-columns:1fr 1fr}}
@media(min-width:800px){.grid{grid-template-columns:1fr 1fr 1fr}}
.learn-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;transition:border-color .2s,transform .15s;display:flex;flex-direction:column}
.learn-card:hover{border-color:var(--accent);transform:translateY(-3px)}
.learn-card img{width:100%;aspect-ratio:4/3;object-fit:cover;background:#1a1a1a}
.learn-card-body{padding:.75rem}
.learn-card-rule{font-size:.7rem;color:var(--accent);background:rgba(200,169,110,.1);border:1px solid rgba(200,169,110,.25);border-radius:4px;display:inline-block;padding:2px 7px;margin-bottom:.4rem}
.learn-card-title{font-family:'Syne',sans-serif;font-size:.95rem;color:var(--text);margin-bottom:.4rem}
.learn-card-tags{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:.3rem}
.tag{font-size:.65rem;color:var(--muted);background:#1a1a1a;border:1px solid var(--border);border-radius:4px;padding:1px 5px}
.learn-card-date{font-size:.65rem;color:#555}
.back-link{text-align:center;padding:1rem}
.back-link a{color:var(--accent);font-size:.85rem;text-decoration:none}
</style>
</head>
<body>
<header class="site-header">
  <a class="site-title" href="https://amitphotos.com">Amit Photos</a>
  <span style="color:var(--muted);font-size:.8rem">📸 בית ספר לצילום</span>
</header>
<div class="page-hero">
  <h1>📸 בית ספר לצילום</h1>
  <p>ניתוח צילומי מעמיק — חוקי קומפוזיציה, הגדרות מצלמה, ומה הצלם חשב</p>
</div>
<div class="grid">${cards}${empty}</div>
<div class="back-link"><a href="https://amitphotos.com">← לגלריה המלאה</a></div>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function buildRuleOverlay(rule, annotations) {
  const gold = 'rgba(200,169,110,0.55)';
  const dash = '6,4';
  if (rule === 'rule_of_thirds') return `
    <line x1="33.3%" y1="0" x2="33.3%" y2="100%" stroke="${gold}" stroke-width="1.5" stroke-dasharray="${dash}"/>
    <line x1="66.6%" y1="0" x2="66.6%" y2="100%" stroke="${gold}" stroke-width="1.5" stroke-dasharray="${dash}"/>
    <line x1="0" y1="33.3%" x2="100%" y2="33.3%" stroke="${gold}" stroke-width="1.5" stroke-dasharray="${dash}"/>
    <line x1="0" y1="66.6%" x2="100%" y2="66.6%" stroke="${gold}" stroke-width="1.5" stroke-dasharray="${dash}"/>
    <circle cx="33.3%" cy="33.3%" r="5" fill="${gold}"/>
    <circle cx="66.6%" cy="33.3%" r="5" fill="${gold}"/>
    <circle cx="33.3%" cy="66.6%" r="5" fill="${gold}"/>
    <circle cx="66.6%" cy="66.6%" r="5" fill="${gold}"/>`;
  if (rule === 'symmetry') return `
    <line x1="50%" y1="0" x2="50%" y2="100%" stroke="${gold}" stroke-width="2" stroke-dasharray="${dash}"/>`;
  if (rule === 'leading_lines') {
    if (!annotations || annotations.length === 0) {
      return `<g stroke="${gold}" fill="${gold}" opacity="0.8">
      <line x1="5%" y1="95%" x2="60%" y2="30%" stroke-width="2"/>
      <polygon points="60%,25% 57%,35% 63%,35%"/>
    </g>`;
    }
    const lines = annotations.map(a => {
      const x = a.x_pct || 50;
      const y = a.y_pct || 50;
      const fromX = x < 50 ? 2 : 98;
      const fromY = y < 50 ? 2 : 98;
      const dx = x - fromX;
      const dy = y - fromY;
      const len = Math.sqrt(dx*dx + dy*dy);
      const nx = dx/len; const ny = dy/len;
      const ax = x - nx*8; const ay = y - ny*8;
      const p1x = ax - ny*4; const p1y = ay + nx*4;
      const p2x = ax + ny*4; const p2y = ay - nx*4;
      return `<line x1="${fromX}%" y1="${fromY}%" x2="${x}%" y2="${y}%" stroke="${gold}" stroke-width="2" opacity="0.8"/>
      <polygon points="${x}%,${y}% ${p1x}%,${p1y}% ${p2x}%,${p2y}%" fill="${gold}" opacity="0.8"/>`;
    }).join('');
    return `<g>${lines}</g>`;
  }
  if (rule === 'framing') return `
    <rect x="10%" y="10%" width="80%" height="80%" fill="none" stroke="${gold}" stroke-width="2" stroke-dasharray="${dash}"/>`;
  if (rule === 'negative_space') return `
    <rect x="0" y="0" width="40%" height="100%" fill="rgba(200,169,110,0.08)"/>`;
  if (rule === 'golden_ratio') {
    const g = 0.618;
    return `
    <g stroke="${gold}" fill="none" stroke-width="1.5" opacity="0.7">
      <!-- Golden rectangle border -->
      <rect x="0" y="0" width="100%" height="100%" fill="none" stroke="${gold}" stroke-width="1" stroke-dasharray="4,4" opacity="0.4"/>
      <!-- Golden ratio vertical divide -->
      <line x1="${g*100}%" y1="0" x2="${g*100}%" y2="100%" stroke-dasharray="4,4" opacity="0.5"/>
      <!-- Spiral arcs (quarter circles progressively smaller) -->
      <path d="M ${g*100}%,0 A ${g*100}%,100% 0 0 0 0,100%" stroke-width="2" opacity="0.9"/>
      <path d="M 0,${g*100}% A ${(1-g)*100}%,${(1-g)*100}% 0 0 1 ${(1-g)*100}%,100%" stroke-width="1.8" opacity="0.8"/>
      <path d="M ${(1-g)*100}%,${g*(1-g)*100}% A ${g*(1-g)*100}%,${g*(1-g)*100}% 0 0 0 0,${g*(1-g)*100}%" stroke-width="1.5" opacity="0.7"/>
    </g>`;
  }
  return '';
}

function buildAnnotations(annotations) {
  return annotations.map(ann => {
    const labelLines = (ann.label || '').split('\n').map(l => escXml(l)).join('<br>');
    const anchorClass = `ann-${ann.anchor || 'right'}`;
    return `<div class="ann" style="left:${ann.x_pct}%;top:${ann.y_pct}%">
      <div class="ann-dot"></div>
      <div class="ann-label ${anchorClass}">${labelLines}</div>
    </div>`;
  }).join('\n');
}

async function handleLearnAnalysis(env, photoId) {
  const row = await env.DB.prepare(
    'SELECT * FROM photo_analyses WHERE photo_id = ?'
  ).bind(photoId).first().catch(() => null);

  const photo = await env.DB.prepare(
    'SELECT id, title, thumbnail, url, exif FROM photos WHERE id = ?'
  ).bind(photoId).first().catch(() => null);

  if (!row || !photo) {
    return new Response(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>לא נמצא</title><style>body{background:#0a0a0a;color:#f0ede8;font-family:'Heebo',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:1rem}</style></head><body><h1 style="color:#c8a96e;font-size:2rem">404</h1><p>הניתוח לא נמצא</p><a href="/learn/" style="color:#c8a96e">← חזרה לבית ספר לצילום</a></body></html>`, {status: 404, headers: {'Content-Type': 'text/html;charset=utf-8'}});
  }

  const annotations = JSON.parse(row.annotations_json || '[]');
  const camera = JSON.parse(row.camera_json || '{}');
  const tags = JSON.parse(row.tags_json || '[]');
  const ruleLabel = RULE_LABELS[row.composition_rule] || row.composition_rule;
  const imgUrl = (photo.thumbnail || photo.url || '') + '?w=900';
  const buyUrl = `https://amitphotos.com/?photo=${encodeURIComponent(photoId)}`;

  const cameraCards = ['aperture', 'shutter', 'iso', 'focal'].map(key => {
    const c = camera[key] || {};
    const labels = { aperture: 'צמצם', shutter: 'מהירות תריס', iso: 'ISO', focal: 'מרחק מוקד' };
    return `<div class="cam-card">
      <div class="cam-label">${labels[key]}</div>
      <div class="cam-value">${escXml(c.value || '—')}</div>
      <div class="cam-desc">${escXml(c.explanation || '')}</div>
    </div>`;
  }).join('\n');

  const tagPills = tags.map(t => `<span class="tag">${escXml(t)}</span>`).join('');

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escXml(row.title)} — ניתוח צילום | Amit Photos</title>
<meta name="description" content="ניתוח צילומי של &quot;${escXml(row.title)}&quot; — ${escXml(ruleLabel)}, הגדרות מצלמה, ופירוש הקומפוזיציה.">
<meta property="og:title" content="📸 ${escXml(row.title)} | ניתוח צילום">
<meta property="og:description" content="ניתוח ${escXml(ruleLabel)} — הגדרות מצלמה ופירוש הקומפוזיציה. מדריך לצלמן מתחיל.">
<meta property="og:image" content="${escXml(photo.thumbnail || photo.url || '')}">
<meta property="og:type" content="article">
<meta property="og:url" content="https://amitphotos.com/learn/${escXml(photoId)}">
<meta property="og:locale" content="he_IL">
<link rel="canonical" href="https://amitphotos.com/learn/${escXml(photoId)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&family=Syne:wght@700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a0a;--surface:#111;--border:#222;--accent:#c8a96e;--text:#f0ede8;--muted:#888}
body{font-family:'Heebo',sans-serif;background:var(--bg);color:var(--text);direction:rtl;min-height:100vh;padding:0 0 4rem}
.site-header{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid var(--border)}
.site-title{font-family:'Syne',sans-serif;font-size:1.1rem;color:var(--accent);text-decoration:none}
.page-header{padding:1.5rem 1.25rem .5rem;max-width:900px;margin:0 auto;display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:.5rem}
.page-title{font-family:'Syne',sans-serif;font-size:1.4rem;color:var(--text)}
.rule-badge{font-size:.72rem;color:var(--accent);background:rgba(200,169,110,.1);border:1px solid rgba(200,169,110,.25);border-radius:4px;padding:3px 9px;margin-top:.3rem;display:inline-block}
.buy-btn{background:var(--accent);color:#000;font-weight:700;font-size:.82rem;border-radius:8px;padding:.5rem 1rem;text-decoration:none;white-space:nowrap;flex-shrink:0}
.photo-wrap{position:relative;max-width:900px;margin:0 auto 1.5rem;padding:0 .75rem}
.photo-wrap img{width:100%;border-radius:10px;display:block}
.rule-overlay{position:absolute;top:.75rem;left:.75rem;right:.75rem;bottom:0;width:calc(100% - 1.5rem);height:100%;pointer-events:none}
.ann{position:absolute;transform:translate(-50%,-50%);pointer-events:none}
.ann-dot{width:10px;height:10px;border-radius:50%;background:var(--accent);border:2px solid #000;position:relative;z-index:2}
.ann-label{position:absolute;background:rgba(0,0,0,.85);border:1px solid var(--accent);border-radius:7px;padding:.3rem .55rem;font-size:.68rem;color:var(--text);line-height:1.45;white-space:nowrap;z-index:3}
.ann-right{left:16px;top:-10px}
.ann-left{right:16px;top:-10px}
.ann-bottom{top:16px;left:50%;transform:translateX(-50%)}
.ann-top{bottom:16px;left:50%;transform:translateX(-50%)}
.cam-cards{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;padding:0 .75rem;max-width:900px;margin:0 auto 1.5rem}
@media(min-width:600px){.cam-cards{grid-template-columns:repeat(4,1fr)}}
.cam-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:.85rem}
.cam-label{font-size:.7rem;color:var(--muted);margin-bottom:.25rem}
.cam-value{font-family:'Syne',sans-serif;font-size:1.05rem;color:var(--accent)}
.cam-desc{font-size:.7rem;color:var(--muted);margin-top:.3rem;line-height:1.4}
.section{max-width:900px;margin:0 auto 1.5rem;padding:0 .75rem}
.section h2{font-family:'Syne',sans-serif;color:var(--accent);font-size:1.05rem;margin-bottom:.75rem}
.bokeh-box{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1.25rem}
.comp-box{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1.1rem;font-size:.85rem;color:var(--muted);line-height:1.75}
.comp-box p{margin-bottom:.7rem}
.comp-box p:last-child{margin-bottom:0}
.comp-box strong{color:var(--text)}
.tags-row{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.75rem}
.tag{font-size:.72rem;color:var(--accent);background:rgba(200,169,110,.1);border:1px solid rgba(200,169,110,.25);border-radius:5px;padding:2px 8px}
.nav-row{text-align:center;padding:1rem}
.nav-row a{color:var(--accent);font-size:.85rem;text-decoration:none;margin:0 .75rem}
</style>
</head>
<body>
<header class="site-header">
  <a class="site-title" href="https://amitphotos.com">Amit Photos</a>
  <a href="/learn/" style="color:var(--muted);font-size:.8rem;text-decoration:none">📸 בית ספר לצילום</a>
</header>

<div class="page-header">
  <div>
    <h1 class="page-title">${escXml(row.title)}</h1>
    <span class="rule-badge">${escXml(ruleLabel)}</span>
  </div>
  <a class="buy-btn" href="${buyUrl}">רכוש תמונה זו ←</a>
</div>

<div class="photo-wrap">
  <img src="${escXml(imgUrl)}" alt="${escXml(row.title)}">
  <svg class="rule-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    ${buildRuleOverlay(row.composition_rule, annotations)}
  </svg>
  ${buildAnnotations(annotations)}
</div>

<div class="cam-cards">${cameraCards}</div>

<div class="section">
  <h2>📊 איך נוצר הבוקה</h2>
  <div class="bokeh-box">
    <svg viewBox="0 0 500 180" style="width:100%;max-width:500px;display:block;margin:0 auto">
      <rect x="20" y="65" width="55" height="50" rx="5" fill="#1a1a1a" stroke="#c8a96e" stroke-width="1.5"/>
      <text x="47" y="95" text-anchor="middle" fill="#c8a96e" font-size="10" font-family="Heebo">מצלמה</text>
      <ellipse cx="75" cy="90" rx="9" ry="20" fill="#222" stroke="#c8a96e" stroke-width="1.5"/>
      <line x1="84" y1="72" x2="210" y2="90" stroke="rgba(200,169,110,.7)" stroke-width="1"/>
      <line x1="84" y1="90" x2="210" y2="90" stroke="rgba(200,169,110,.7)" stroke-width="1"/>
      <line x1="84" y1="108" x2="210" y2="90" stroke="rgba(200,169,110,.7)" stroke-width="1"/>
      <line x1="210" y1="0" x2="210" y2="180" stroke="#4ade80" stroke-width="2" stroke-dasharray="4,3"/>
      <text x="214" y="20" fill="#4ade80" font-size="10" font-family="Heebo">נושא (חד)</text>
      <circle cx="210" cy="90" r="5" fill="#4ade80"/>
      <line x1="210" y1="90" x2="410" y2="50" stroke="rgba(136,136,136,.5)" stroke-width="1"/>
      <line x1="210" y1="90" x2="410" y2="90" stroke="rgba(136,136,136,.5)" stroke-width="1"/>
      <line x1="210" y1="90" x2="410" y2="130" stroke="rgba(136,136,136,.5)" stroke-width="1"/>
      <line x1="410" y1="0" x2="410" y2="180" stroke="#888" stroke-width="1.5" stroke-dasharray="4,3"/>
      <text x="414" y="20" fill="#888" font-size="10" font-family="Heebo">רקע (מטושטש)</text>
      <circle cx="410" cy="50" r="16" fill="none" stroke="rgba(200,169,110,.4)" stroke-width="1.5"/>
      <circle cx="410" cy="90" r="16" fill="none" stroke="rgba(200,169,110,.4)" stroke-width="1.5"/>
      <circle cx="410" cy="130" r="16" fill="none" stroke="rgba(200,169,110,.4)" stroke-width="1.5"/>
      <text x="75" y="145" text-anchor="middle" fill="#c8a96e" font-size="9" font-family="Heebo">פתח עדשה = עומק שדה</text>
    </svg>
  </div>
</div>

<div class="section">
  <h2>🎨 ניתוח קומפוזיציה</h2>
  <div class="comp-box">
    ${row.composition_html || ''}
    <div class="tags-row">${tagPills}</div>
  </div>
</div>

<div class="nav-row">
  <a href="/learn/">← כל הניתוחים</a>
  <a href="${buyUrl}">רכוש תמונה זו</a>
  <a href="https://amitphotos.com">לגלריה</a>
</div>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ===== MAIN ROUTER =====
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (url.hostname === 'www.amitphotos.com') {
      return Response.redirect('https://amitphotos.com' + url.pathname + url.search, 301);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (path === '/api/login')             return handleLogin(request, env);
    if (path === '/api/logout')            return handleLogout(request, env);
    if (path === '/api/forgot-password')   return handleForgotPassword(request, env);
    if (path === '/api/reset-password')    return handleResetPassword(request, env);
    if (path === '/api/subscribers')       return handleSubscribers(request, env);
    if (path === '/api/customers')         return handleCustomers(request, env);
    if (path === '/api/photos')            return handlePhotos(request, env);
    if (path === '/api/quiz-photos')       return handleQuizPhotos(request, env);
    if (path === '/api/sale-photos')       return handleSalePhotos(request, env);
    if (path === '/api/sale/rotate' && request.method === 'POST') return handleSaleRotate(request, env);
    if (path === '/api/upload')            return handleUpload(request, env);
    if (path === '/api/repair-r2')         return handleRepairR2(request, env);
    if (path === '/api/fill-titles')       return handleFillTitles(request, env);
    if (path === '/api/generate-alt')      return handleGenerateAlt(request, env);
    if (path === '/api/trigger-workflow')  return handleTriggerWorkflow(request, env);
    if (path === '/api/newsletter')        return handleNewsletter(request, env);
    if (path === '/api/unsubscribe')       return handleUnsubscribe(request, env);
    if (path === '/api/reply')             return handleReply(request, env);
    if (path === '/api/verify-payment')    return handleVerifyPayment(request, env, ctx);
    if (path === '/api/admin/purchases')   return handleAdminPurchases(request, env);
    if (path === '/api/admin/create-token' && request.method === 'POST') return handleAdminCreateToken(request, env);
    if (path === '/api/new-badge-settings') return handleNewBadgeSettings(request, env);
    if (path === '/api/admin/prices') return handleAdminPrices(request, env);
    if (path === '/api/admin/photo-price' && request.method === 'POST') return handleAdminPhotoPrice(request, env);
    if (path === '/api/photos/reorder' && request.method === 'POST') return handlePhotosReorder(request, env);
    if (path === '/api/admin/photo-of-week/suggest' && request.method === 'POST') return handlePhotoOfWeekSuggest(request, env);
    if (path === '/api/admin/photo-of-week/set' && request.method === 'POST') return handlePhotoOfWeekSet(request, env);
    if (path === '/api/admin/photo-of-week/clear' && request.method === 'POST') return handlePhotoOfWeekClear(request, env);
    if (path === '/api/admin/photo-of-week/caption' && request.method === 'POST') return handlePhotoOfWeekCaption(request, env);
    if (path === '/api/admin/toggle-photo-new' && request.method === 'POST') return handleTogglePhotoNew(request, env);
    if (path === '/api/admin/featured') return handleAdminFeatured(request, env);
    if (path === '/api/admin/upload-story' && request.method === 'POST') return handleUploadStory(request, env);
    if (path.startsWith('/api/admin/replace-photo/') && request.method === 'POST') return handleAdminReplacePhoto(request, env, path.slice('/api/admin/replace-photo/'.length));
    if (path === '/api/admin/photo-dimensions' && request.method === 'POST') return handleAdminPhotoDimensions(request, env);
    if (path === '/prices') return handlePricesPage(request, env);
    if (path === '/api/admin/migrate-amount' && request.method === 'POST') {
      if (!await checkAuth(request, env)) return unauth(request);
      await env.DB.prepare('ALTER TABLE download_tokens ADD COLUMN amount REAL DEFAULT 0').run().catch(() => {});
      return jsonRes({ ok: true }, 200, request);
    }
    if (path === '/api/admin/migrate-photo-dimensions' && request.method === 'POST') {
      if (!await checkAuth(request, env)) return unauth(request);
      await env.DB.prepare('ALTER TABLE photos ADD COLUMN width INTEGER').run().catch(() => {});
      await env.DB.prepare('ALTER TABLE photos ADD COLUMN height INTEGER').run().catch(() => {});
      return jsonRes({ ok: true }, 200, request);
    }
    if (path === '/api/admin/migrate-analyses' && request.method === 'POST') return handleMigrateAnalyses(request, env);
    if (path === '/api/analyses' && request.method === 'GET')                    return handleAnalysesList(request, env);
    if (path === '/api/analyses/generate' && request.method === 'POST')          return handleAnalysesGenerate(request, env);
    if (path.startsWith('/api/analyses/') && request.method === 'GET')           return handleAnalysesGet(request, env, path.slice('/api/analyses/'.length));
    if (path.startsWith('/api/analyses/') && request.method === 'PUT')           return handleAnalysesUpdate(request, env, path.slice('/api/analyses/'.length));
    if (path.startsWith('/api/download/')) return handleDownload(request, env, path.slice('/api/download/'.length));
    if (path === '/api/print/catalog')        return handlePrintCatalog(request, env);
    if (path === '/api/print/quote')          return handlePrintQuote(request, env);
    if (path === '/api/print/upload-crop')    return handlePrintUploadCrop(request, env);
    if (path === '/api/print/order-complete') return handlePrintOrderComplete(request, env);
    if (path === '/api/print/cancel')         return handlePrintCancel(request, env);
    if (path === '/api/print/webhook')        return handlePrintWebhook(request, env);
    if (path === '/api/print/refresh-status') return handlePrintRefreshStatus(request, env);
    if (path === '/api/print/orders')         return handlePrintOrders(request, env);
    if (path === '/api/proxy-image')          return handleImageProxy(request, env);
    if (path === '/api/analytics')         return handleAnalytics(request, env);
    if (path.startsWith('/photos/'))       return servePhoto(path.slice('/photos/'.length), env, request);
    if (path.startsWith('/photo/'))        return servePhotoPage(path.slice('/photo/'.length), env);
    if (path.startsWith('/category/'))     return handleCategoryPage(decodeURIComponent(path.slice('/category/'.length)), env);
    if (path.startsWith('/learn/') && path.length > '/learn/'.length)  return handleLearnAnalysis(env, decodeURIComponent(path.slice('/learn/'.length)));
    if (path === '/learn' || path === '/learn/')   return handleLearnIndex(env);
    if (path === '/sitemap.xml')           return handleSitemap(request, env);
    if (path === '/robots.txt')            return handleRobots(request);

    // Static assets — track page views for HTML pages
    const res = await env.ASSETS.fetch(request);
    if (request.method === 'GET' && !path.startsWith('/api/') && (path === '/' || path.endsWith('.html') || path === '')) {
      const ctx = { waitUntil: (p) => p }; // best-effort
      trackPageView(env, request);
    }

    // קבצים שמשתנים בכל deploy — תמיד לאמת עם השרת
    const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : '';
    const isHtml = ext === 'html' || ext === '' || path === '/'; // נתיבים ללא סיומת = HTML
    const isDynamic = isHtml || ['js', 'css', 'json'].includes(ext);
    if (isDynamic) {
      const newRes = new Response(res.body, res);
      // HTML: no-store מונע כל קאש (דפדפן + CDN)
      // JS/CSS/JSON: no-cache = חייב לאמת עם שרת לפני שימוש
      newRes.headers.set('Cache-Control', isHtml ? 'no-store' : 'no-cache');
      if (isHtml) {
        newRes.headers.set('CDN-Cache-Control', 'no-store');
        newRes.headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
      }
      return newRes;
    }

    return res;
  },
};
