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
    'Cache-Control': 'no-store',
  };
}

function jsonRes(data, status = 200, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: request ? corsHeaders(request) : { 'Content-Type': 'application/json' }
  });
}
function unauth(request) { return jsonRes({ error: 'לא מורשה' }, 401, request); }

function slugify(text) {
  const map = {
    'א':'a','ב':'b','ג':'g','ד':'d','ה':'h','ו':'v','ז':'z','ח':'ch','ט':'t',
    'י':'y','כ':'k','ך':'k','ל':'l','מ':'m','ם':'m','נ':'n','ן':'n','ס':'s',
    'ע':'a','פ':'p','ף':'p','צ':'tz','ץ':'tz','ק':'k','ר':'r','ש':'sh','ת':'t'
  };
  return text
    .split('').map(c => map[c] || c).join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function checkAuth(request, env) {
  // Session token — header (fetch requests) or cookie (page navigations)
  const token = request.headers.get('X-Session-Token')
    || (request.headers.get('Cookie') || '').match(/(?:^|;\s*)admin_session=([^;]+)/)?.[1];
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
    const q = url.searchParams.get('q') || '';
    const limitParam = parseInt(url.searchParams.get('limit')) || 0;
    // ?admin=1 מחייב auth; גישה ציבורית — רק published
    if (adminAll && !await checkAuth(request, env)) return unauth(request);

    let sql, params;
    if (q && !adminAll) {
      // title search (public, published only)
      sql = `SELECT id, title, category, url, thumbnail FROM photos WHERE title LIKE ? AND published = 1 ORDER BY created_at DESC${limitParam ? ' LIMIT ?' : ''}`;
      params = limitParam ? [`%${q}%`, limitParam] : [`%${q}%`];
      const { results: qResults } = await env.DB.prepare(sql).bind(...params).all();
      return jsonRes(qResults, 200, request);
    }

    sql = adminAll
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
async function handleUpload(request, env, ctx) {
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

  // Auto-post to Pinterest in background (non-blocking)
  if (ctx) {
    const photoForPin = { url, thumbnail: thumbUrl, title, category, description: formData.get('description') || '' };
    ctx.waitUntil(autoPostPhotoToPinterest(id, photoForPin, env));
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

const HE_TO_EN_CATEGORY = {
  'טבע': 'Nature Photography',
  'פורטרטים': 'Portrait Photography',
  'עירוני': 'Street Photography',
  'אירועים': 'Event Photography',
  'בעלי חיים': 'Wildlife Photography',
  'פרחים וצמחים': 'Flower Photography',
  'טבע דומם': 'Still Life Photography',
  'צילום מופשט': 'Abstract Photography',
  'מאקרו-צילומי תקריב': 'Macro Photography',
  'ישראל': 'Israel Photography',
  'איטליה': 'Italy Photography',
  'אנגליה': 'England Photography',
  'גרמניה': 'Germany Photography',
  'הולנד': 'Netherlands Photography',
  'וינה': 'Vienna Photography',
  'יוון': 'Greece Photography',
  'טנזניה': 'Tanzania Photography',
  'מונטנגרו': 'Montenegro Photography',
  'סלובקיה': 'Slovakia Photography',
  'סן דיאגו - ארה"ב': 'San Diego Photography',
  'ספרד ואנדורה': 'Spain & Andorra Photography',
  'צכיה': 'Czech Republic Photography',
  'אבו דאבי': 'Abu Dhabi Photography',
};

async function translateTitleEn(title, description, category, env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  try {
    const prompt = `Translate this Hebrew photo title to English for a Pinterest pin. Keep it short (2-6 words), evocative, and suitable for fine art photography.
Hebrew title: "${title}"
Category: "${HE_TO_EN_CATEGORY[category] || category}"
${description ? `Description hint (Hebrew): "${description}"` : ''}
Return ONLY the English title, nothing else.`;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 20,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.[0]?.text?.trim().replace(/^["']|["']$/g, '') || null;
  } catch { return null; }
}

async function findOrCreateBoardEn(categoryName, env, token) {
  const cacheKey = `pinterest_board_en_${categoryName}`;
  const cached = await env.DB.prepare(`SELECT value FROM settings WHERE key=?`).bind(cacheKey).first();
  if (cached) return cached.value;
  const englishName = HE_TO_EN_CATEGORY[categoryName] || `${categoryName} Photography`;
  const listRes = await fetch('https://api.pinterest.com/v5/boards?page_size=100', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!listRes.ok) return null;
  const listData = await listRes.json();
  const existing = listData.items?.find(b => b.name.toLowerCase() === englishName.toLowerCase());
  if (existing) {
    await env.DB.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(cacheKey, existing.id).run();
    return existing.id;
  }
  const createRes = await fetch('https://api.pinterest.com/v5/boards', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: englishName, description: `Fine art photography by Amit Erez | amitphotos.com`, privacy: 'PUBLIC' }),
  });
  if (!createRes.ok) return null;
  const created = await createRes.json();
  if (!created.id) return null;
  await env.DB.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(cacheKey, created.id).run();
  return created.id;
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

async function handleTrackEvent(request, env) {
  try {
    const { event_type, photo_id, photo_title, category } = await request.json();
    if (!['photo_view', 'purchase_intent'].includes(event_type) || !photo_id) return jsonRes({ ok: false });
    await env.DB.prepare(
      'INSERT INTO photo_events (event_type, photo_id, photo_title, category, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(event_type, String(photo_id), photo_title || '', category || '', new Date().toISOString()).run();
    return jsonRes({ ok: true });
  } catch { return jsonRes({ ok: false }); }
}

async function handleAdminPhotoAnalytics(request, env) {
  if (!await checkAuth(request, env)) return jsonRes({ error: 'Unauthorized' }, 401, request);
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [views, intents, purchases] = await Promise.all([
    env.DB.prepare(
      `SELECT photo_id, photo_title, category, COUNT(*) as count FROM photo_events
       WHERE event_type='photo_view' AND created_at>=? GROUP BY photo_id ORDER BY count DESC LIMIT 20`
    ).bind(since).all(),
    env.DB.prepare(
      `SELECT photo_id, COUNT(*) as count FROM photo_events
       WHERE event_type='purchase_intent' AND created_at>=? GROUP BY photo_id ORDER BY count DESC LIMIT 20`
    ).bind(since).all(),
    env.DB.prepare(
      `SELECT photo_id, COUNT(*) as count, ROUND(SUM(sell_price),0) as revenue FROM print_orders
       WHERE created_at>=? GROUP BY photo_id ORDER BY count DESC LIMIT 20`
    ).bind(since).all(),
  ]);
  return jsonRes({ views: views.results, intents: intents.results, purchases: purchases.results });
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
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const msgHtml = (title, msg, icon) => new Response(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f4f4;font-family:Arial,sans-serif">
  <div style="background:#fff;border-radius:8px;padding:48px 40px;max-width:440px;width:100%;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.08)">
    <div style="color:#c8a96e;font-size:18px;font-weight:700;letter-spacing:.22em;font-family:Georgia,serif;margin-bottom:24px">AMIT PHOTOS</div>
    <div style="font-size:2rem;margin-bottom:16px">${icon}</div>
    <h2 style="margin:0 0 12px;font-size:20px;color:#111">${title}</h2>
    <p style="color:#666;font-size:14px;line-height:1.7;margin:0 0 24px">${msg}</p>
    <a href="https://amitphotos.com" style="display:inline-block;padding:.6rem 1.6rem;background:#0a0a0a;color:#c8a96e;text-decoration:none;border-radius:4px;font-size:14px">חזרה לאתר</a>
  </div>
</body></html>`, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

  // Token-based (from email link)
  if (token) {
    const row = await env.DB.prepare('SELECT id FROM subscribers WHERE id=?').bind(token).first().catch(() => null);
    if (!row) return msgHtml('כבר הוסרת', 'כתובת המייל שלך אינה ברשימה.', 'ℹ️');
    await env.DB.prepare('DELETE FROM subscribers WHERE id=?').bind(token).run();
    return msgHtml('הוסרת בהצלחה', 'הוסרת מרשימת הניוזלטר. לא תקבל עוד מיילים מאיתנו.', '✅');
  }

  // Email-based (from website form) — POST only
  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const email = (body.email || '').trim().toLowerCase();
    if (!email) return jsonRes({ error: 'נדרשת כתובת מייל' }, 400, request);
    const row = await env.DB.prepare('SELECT id FROM subscribers WHERE lower(email)=?').bind(email).first().catch(() => null);
    if (!row) return jsonRes({ ok: true, notFound: true }, 200, request);
    await env.DB.prepare('DELETE FROM subscribers WHERE id=?').bind(row.id).run();
    return jsonRes({ ok: true }, 200, request);
  }

  return msgHtml('קישור לא תקין', 'הקישור להסרה אינו תקין.', '❌');
}

// ===== ANALYTICS =====
async function trackPageView(env, request, page) {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const country = request.headers.get('CF-IPCountry') || 'XX';
    await env.DB.prepare(
      'INSERT INTO analytics (date, views) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET views = views + 1'
    ).bind(date).run();
    await env.DB.prepare(
      'INSERT INTO analytics_countries (date, country, views) VALUES (?, ?, 1) ON CONFLICT(date, country) DO UPDATE SET views = views + 1'
    ).bind(date, country).run();
    if (page) {
      await env.DB.prepare(
        'CREATE TABLE IF NOT EXISTS analytics_pages (date TEXT NOT NULL, page TEXT NOT NULL, views INTEGER DEFAULT 0, PRIMARY KEY(date,page))'
      ).run().catch(() => {});
      await env.DB.prepare(
        'INSERT INTO analytics_pages (date, page, views) VALUES (?,?,1) ON CONFLICT(date,page) DO UPDATE SET views=views+1'
      ).bind(date, page).run();
    }
  } catch { /* non-critical */ }
}

async function handleAnalytics(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS analytics_pages (date TEXT NOT NULL, page TEXT NOT NULL, views INTEGER DEFAULT 0, PRIMARY KEY(date,page))'
  ).run().catch(() => {});
  const [{ results: daily }, { results: countries }, { results: pages }, thisWeekRow, prevWeekRow] = await Promise.all([
    env.DB.prepare('SELECT date, views FROM analytics ORDER BY date DESC LIMIT 30').all(),
    env.DB.prepare(
      'SELECT country, SUM(views) as total FROM analytics_countries WHERE date >= date("now", "-30 days") GROUP BY country ORDER BY total DESC LIMIT 10'
    ).all(),
    env.DB.prepare(
      'SELECT page, SUM(views) as total FROM analytics_pages WHERE date >= date("now", "-30 days") GROUP BY page ORDER BY total DESC LIMIT 12'
    ).all(),
    env.DB.prepare('SELECT SUM(views) as total FROM analytics WHERE date >= date("now","-7 days")').first(),
    env.DB.prepare('SELECT SUM(views) as total FROM analytics WHERE date >= date("now","-14 days") AND date < date("now","-7 days")').first(),
  ]);
  return jsonRes({
    daily,
    countries,
    pages: pages || [],
    weekTotal: thisWeekRow?.total || 0,
    prevWeekTotal: prevWeekRow?.total || 0,
  }, 200, request);
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
    "license": "https://amitphotos.com/privacy/",
    "acquireLicensePage": `https://amitphotos.com/?photo=${photoId}`,
    "creditText": "עמית ארז",
    "copyrightNotice": "© עמית ארז. כל הזכויות שמורות.",
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
      'Cache-Control': 'no-cache, no-store, must-revalidate',
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
    headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' },
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
    { loc: '/', priority: '1.0', changefreq: 'daily' },
    { loc: '/learn/', priority: '0.8', changefreq: 'weekly' },
    { loc: '/camera/', priority: '0.9', changefreq: 'weekly' },
    { loc: '/camera/composition/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/controls/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/depth-of-field/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/dynamic-range/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/editing/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/exposure/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/filters/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/focus/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/histogram/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/landscape/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/lenses/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/light/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/macro/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/portrait/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/software/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/sports/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/types/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/visual-language/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/camera/white-balance/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/gear/', priority: '0.7', changefreq: 'monthly' },
    { loc: '/locations/', priority: '0.8', changefreq: 'weekly' },
    { loc: '/newsletter/', priority: '0.6', changefreq: 'weekly' },
    { loc: '/games/', priority: '0.7', changefreq: 'monthly' },
    { loc: '/quiz/', priority: '0.7', changefreq: 'monthly' },
    { loc: '/puzzle/', priority: '0.7', changefreq: 'monthly' },
    { loc: '/sale/', priority: '0.7', changefreq: 'weekly' },
    { loc: '/privacy/', priority: '0.3', changefreq: 'yearly' },
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

  // דפי ניתוח תמונות
  let learnUrls = [];
  try {
    const { results: analyses } = await env.DB.prepare(
      'SELECT photo_id, published_at FROM photo_analyses ORDER BY published_at DESC'
    ).all();
    learnUrls = analyses.map(a => `  <url>
    <loc>${base}/learn/${escXml(a.photo_id)}</loc>
    <lastmod>${toDate(a.published_at)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`);
  } catch (_) {}

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${staticXml}
${categoryUrls.join('\n')}
${photoUrls.join('\n')}
${learnUrls.join('\n')}
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

// ===== LOCATION SPOT PAGE — SERVER-SIDE OG INJECTION =====
async function handleLocationSpotPage(request, env) {
  const slug = new URL(request.url).searchParams.get('slug');

  // Reject obviously invalid slugs (template literals, empty, too long)
  if (!slug || slug.length > 200 || slug.includes('${') || slug.includes('escHtml') || slug.includes('encodeURI')) {
    return new Response('Not Found', { status: 404 });
  }

  // Fetch location data
  const loc = await env.DB.prepare(
    'SELECT id, title, description, region, coordinates FROM locations WHERE id = ? AND published = 1'
  ).bind(slug).first().catch(() => null);

  // 404 for unknown slugs — prevents Google from indexing junk URLs
  if (!loc) {
    return new Response('Not Found', { status: 404 });
  }

  // Fetch the static HTML
  const assetRes = await env.ASSETS.fetch(new Request(new URL('/locations/spot/', request.url).href));
  if (!assetRes.ok) return assetRes;

  let html = await assetRes.text();

  const title = escXml(loc.title + ' | מקומות לצילום — עמית ארז');
  const desc = escXml((loc.description || '').slice(0, 160));
  const canonicalUrl = `https://amitphotos.com/locations/spot/?slug=${encodeURIComponent(loc.id)}`;
  const pageUrl = escXml(canonicalUrl);

  // Get cover photo
  const cover = await env.DB.prepare(
    'SELECT url FROM location_photos WHERE location_id = ? ORDER BY sort_order ASC LIMIT 1'
  ).bind(slug).first().catch(() => null);
  const imgUrl = escXml(cover?.url || 'https://amitphotos.com/assets/img/og-default.jpg');

  const ogTags = `
  <link rel="canonical" href="${pageUrl}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${desc}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:image" content="${imgUrl}">
  <meta property="og:type" content="website">
  <meta name="description" content="${desc}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${desc}">
  <meta name="twitter:image" content="${imgUrl}">`;

  html = html.replace('</head>', ogTags + '\n</head>');

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

// ===== ROBOTS.TXT =====
function handleRobots(request) {
  const base = 'https://amitphotos.com';
  const txt = `User-agent: *
Disallow: /api/
Disallow: /admin.html

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
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' } });
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function handleTogglePhotoNew(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { photo_id, is_new, title, category, url, thumbnail } = await request.json().catch(() => ({}));
  if (!photo_id) return jsonRes({ error: 'photo_id required' }, 400, request);
  const addedAt = is_new ? new Date().toISOString().split('T')[0] : null;
  const result = await env.DB.prepare(
    "UPDATE photos SET is_new = ?, added_at = CASE WHEN ? IS NOT NULL THEN ? ELSE added_at END WHERE id = ?"
  ).bind(is_new ? 1 : 0, addedAt, addedAt, photo_id).run();
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
      `SELECT a.photo_id, a.title, a.title_en, a.composition_rule, a.published_at,
              a.composition_html, a.camera_json,
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
      `SELECT a.*, p.thumbnail AS photo_thumbnail, p.url AS photo_url, p.title AS photo_title
       FROM photo_analyses a
       LEFT JOIN photos p ON p.id = a.photo_id
       WHERE a.photo_id = ?`
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

async function handleAnalysesPublishAll(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE photo_analyses SET published_at = ?').bind(now).run();
  return jsonRes({ ok: true }, 200, request);
}

async function handleAnalysesUpdate(request, env, photoId) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'PUT') return jsonRes({ error: 'PUT only' }, 405, request);
  const body = await request.json().catch(() => ({}));
  const fields = [];
  const values = [];
  if (body.composition_rule !== undefined)    { fields.push('composition_rule = COALESCE(?, composition_rule)'); values.push(body.composition_rule || null); }
  if (body.composition_html !== undefined)    { fields.push('composition_html = ?');    values.push(body.composition_html); }
  if (body.tags_json !== undefined)           { fields.push('tags_json = ?');           values.push(body.tags_json); }
  if (body.camera_json !== undefined)         { fields.push('camera_json = ?');         values.push(body.camera_json); }
  if (body.annotations_json !== undefined)    { fields.push('annotations_json = ?');    values.push(body.annotations_json); }
  if (body.title !== undefined)               { fields.push('title = ?');               values.push(body.title); }
  if (body.published_at !== undefined)        { fields.push('published_at = ?');        values.push(body.published_at); }
  if (body.title_en !== undefined)            { fields.push('title_en = ?');            values.push(body.title_en); }
  if (body.composition_html_en !== undefined) { fields.push('composition_html_en = ?'); values.push(body.composition_html_en); }
  if (body.camera_json_en !== undefined)      { fields.push('camera_json_en = ?');      values.push(body.camera_json_en); }
  if (body.tags_json_en !== undefined)        { fields.push('tags_json_en = ?');        values.push(body.tags_json_en); }
  if (!fields.length) return jsonRes({ error: 'אין שדות לעדכון' }, 400, request);
  values.push(photoId);
  await env.DB.prepare(`UPDATE photo_analyses SET ${fields.join(', ')} WHERE photo_id = ?`).bind(...values).run();
  return jsonRes({ ok: true }, 200, request);
}

async function handleAnalysesDedup(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);

  // Fetch all analyses with photo metadata
  const { results: all } = await env.DB.prepare(`
    SELECT a.photo_id, a.published_at, a.title,
           p.r2_key, p.thumbnail
    FROM photo_analyses a
    LEFT JOIN photos p ON p.id = a.photo_id
    ORDER BY a.published_at DESC NULLS LAST
  `).all();

  const toDelete = [];
  const seenR2  = new Set();
  const seenThumb = new Set();
  const seenTitle = new Set();

  for (const row of (all || [])) {
    const key = row.r2_key && row.r2_key !== '' ? row.r2_key : null;
    const thumb = row.thumbnail && row.thumbnail !== '' ? row.thumbnail : null;
    const title = (row.title || '').trim().toLowerCase();

    const isDupe = (key && seenR2.has(key)) ||
                   (thumb && seenThumb.has(thumb)) ||
                   (title && seenTitle.has(title));

    if (isDupe) {
      toDelete.push(row.photo_id);
    } else {
      if (key)   seenR2.add(key);
      if (thumb) seenThumb.add(thumb);
      if (title) seenTitle.add(title);
    }
  }

  for (const id of toDelete) {
    await env.DB.prepare('DELETE FROM photo_analyses WHERE photo_id = ?').bind(id).run();
  }
  return jsonRes({ deleted: toDelete.length, ids: toDelete }, 200, request);
}

async function handleAnalysesDelete(request, env, photoId) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'DELETE') return jsonRes({ error: 'DELETE only' }, 405, request);
  try {
    await env.DB.prepare('DELETE FROM photo_analyses WHERE photo_id = ?').bind(photoId).run();
    return jsonRes({ ok: true }, 200, request);
  } catch (e) {
    return jsonRes({ error: String(e) }, 500, request);
  }
}

async function handleAnalysesGenerateEn(request, env, photoId) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: 'ANTHROPIC_API_KEY חסר' }, 500, request);

  const row = await env.DB.prepare('SELECT * FROM photo_analyses WHERE photo_id = ?').bind(photoId).first();
  if (!row) return jsonRes({ error: 'לא נמצא' }, 404, request);

  let camera = {};
  try { camera = JSON.parse(row.camera_json || '{}'); } catch (_) {}

  let annotations = [];
  try { annotations = JSON.parse(row.annotations_json || '[]'); } catch (_) {}

  const cameraStr = ['aperture','shutter','iso','focal'].map(k => {
    const c = camera[k] || {};
    return c.value ? `${k}: value="${c.value}", explanation="${c.explanation || ''}"` : '';
  }).filter(Boolean).join('\n');

  let tags = [];
  try { tags = JSON.parse(row.tags_json || '[]'); } catch (_) {}

  const annLabels = annotations
    .filter(a => a.label)
    .map((a, i) => `${i}: "${a.label.replace(/\n/g, '\\n')}"`)
    .join('\n');

  const tagsStr = tags.join(', ');

  const prompt = `You are Amit Erez, an Israeli fine-art photographer writing educational photo analyses for an international audience.
Translate the following Hebrew photography analysis to English. Write in first person, personal and inspiring tone.

Photo title: ${row.title}
Composition rule: ${row.composition_rule}

Camera settings (translate only the explanation, keep the value as-is):
${cameraStr}

Composition analysis HTML (translate text content only, preserve all HTML tags exactly):
${row.composition_html || ''}

${annLabels ? `Annotation labels on the photo (short, concise labels — keep \\n for line breaks):
${annLabels}` : ''}

${tagsStr ? `Tags (translate to short English keywords, same count):
${tagsStr}` : ''}

Return ONLY valid JSON, no markdown:
{
  "title_en": "English title",
  "camera_json_en": {
    "aperture": {"explanation":"English explanation"},
    "shutter": {"explanation":"English explanation"},
    "iso": {"explanation":"English explanation"},
    "focal": {"explanation":"English explanation"}
  },
  "composition_html_en": "<p>...translated HTML...</p>"${annLabels ? `,
  "annotation_labels_en": {"0": "English label", "1": "English label"}` : ''}${tagsStr ? `,
  "tags_en": ["tag1", "tag2", "tag3"]` : ''}
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
  });
  if (!res.ok) return jsonRes({ error: 'Claude API נכשל', status: res.status }, 502, request);

  const data = await res.json();
  const text = (data.content?.[0]?.text || '').trim();
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return jsonRes({ error: 'JSON לא תקין' }, 500, request);
    try { parsed = JSON.parse(match[0]); } catch { return jsonRes({ error: 'JSON לא תקין' }, 500, request); }
  }

  // Merge camera_json_en values (keep original value, add translated explanation)
  const camEnMerged = {};
  for (const k of ['aperture','shutter','iso','focal']) {
    const orig = camera[k] || {};
    const trans = (parsed.camera_json_en || {})[k] || {};
    camEnMerged[k] = { value: orig.value, explanation: trans.explanation || orig.explanation || '' };
  }

  // Merge label_en into each annotation
  const annLabelsEn = parsed.annotation_labels_en || {};
  let annIdx = 0;
  const annotationsUpdated = annotations.map(a => {
    if (!a.label) return a;
    const en = annLabelsEn[String(annIdx++)];
    return en ? { ...a, label_en: en.replace(/\\n/g, '\n') } : a;
  });

  const tagsEnJson = (parsed.tags_en && Array.isArray(parsed.tags_en) && parsed.tags_en.length)
    ? JSON.stringify(parsed.tags_en)
    : null;

  // Try to save tags_en (column may not exist yet — ignore error)
  try {
    await env.DB.prepare('ALTER TABLE photo_analyses ADD COLUMN tags_json_en TEXT DEFAULT \'[]\'').run();
  } catch (_) {}

  const updateFields = tagsEnJson
    ? 'title_en=?, composition_html_en=?, camera_json_en=?, annotations_json=?, tags_json_en=?'
    : 'title_en=?, composition_html_en=?, camera_json_en=?, annotations_json=?';
  const updateValues = tagsEnJson
    ? [parsed.title_en || row.title, parsed.composition_html_en || row.composition_html || '', JSON.stringify(camEnMerged), JSON.stringify(annotationsUpdated), tagsEnJson, photoId]
    : [parsed.title_en || row.title, parsed.composition_html_en || row.composition_html || '', JSON.stringify(camEnMerged), JSON.stringify(annotationsUpdated), photoId];

  await env.DB.prepare(`UPDATE photo_analyses SET ${updateFields} WHERE photo_id=?`).bind(...updateValues).run();

  return jsonRes({ ok: true, title_en: parsed.title_en }, 200, request);
}

async function handleAnalysesGenerate(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: 'ANTHROPIC_API_KEY חסר' }, 500, request);

  // Support optional photo_id in POST body for card-level analysis
  const body = await request.json().catch(() => ({}));
  const requestedPhotoId = body?.photo_id ?? null;

  let candidates;
  if (requestedPhotoId) {
    // Specific photo requested — fetch it directly (re-analysis allowed)
    const { results } = await env.DB.prepare(`
      SELECT id, title, thumbnail, url, r2_key, description
      FROM photos
      WHERE id = ?
    `).bind(requestedPhotoId).all();
    candidates = results;
    if (!candidates || candidates.length === 0) {
      return jsonRes({ error: 'תמונה לא נמצאה' }, 404, request);
    }
  } else {
    // 1. Pick 5 candidates (unanalyzed, published, unique r2_key)
    // Exclude photos whose r2_key is already covered by an existing analysis (different photo_id, same image)
    const { results } = await env.DB.prepare(`
      SELECT p.id, p.title, p.thumbnail, p.url, p.r2_key, p.description
      FROM photos p
      LEFT JOIN photo_analyses a ON a.photo_id = p.id
      WHERE a.photo_id IS NULL
        AND p.published = 1
        AND p.r2_key IS NOT NULL
        AND p.r2_key != ''
        AND p.width > 0
        AND p.width <= 2000
        AND p.r2_key NOT IN (
          SELECT p2.r2_key FROM photos p2
          INNER JOIN photo_analyses a2 ON a2.photo_id = p2.id
          WHERE p2.r2_key IS NOT NULL AND p2.r2_key != ''
        )
      ORDER BY RANDOM()
      LIMIT 5
    `).all();
    candidates = results;
    if (!candidates || candidates.length === 0) {
      return jsonRes({ error: 'אין תמונות זמינות לניתוח' }, 404, request);
    }
  }

  // 2. Pick candidate — prefer R2 under 4.5MB, fall back to URL source (Claude fetches directly)
  const toB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  };

  let chosen = null;
  let imgSource = null; // { type:'base64', media_type, data } or { type:'url', url }

  for (const candidate of candidates) {
    const obj = candidate.r2_key ? await env.PHOTOS.get(candidate.r2_key) : null;
    if (obj && obj.size <= 4.5 * 1024 * 1024) {
      chosen = candidate;
      const mime = obj.httpMetadata?.contentType || 'image/jpeg';
      imgSource = { type: 'base64', media_type: mime, data: toB64(await obj.arrayBuffer()) };
      break;
    }
    // R2 too large — try thumbnail directly from R2, then URL source
    const imgUrl = candidate.thumbnail || candidate.url;
    if (imgUrl) {
      // For relative /photos/ URLs: extract key and fetch thumbnail from R2 directly
      if (imgUrl.startsWith('/photos/')) {
        const thumbKey = imgUrl.slice('/photos/'.length);
        if (thumbKey && thumbKey !== candidate.r2_key) {
          const thumbObj = await env.PHOTOS.get(thumbKey);
          if (thumbObj && thumbObj.size <= 10 * 1024 * 1024) {
            chosen = candidate;
            const mime = thumbObj.httpMetadata?.contentType || 'image/jpeg';
            imgSource = { type: 'base64', media_type: mime, data: toB64(await thumbObj.arrayBuffer()) };
            break;
          }
        }
        // No separate thumbnail — subrequest to self with absolute URL
        try {
          const origin = new URL(request.url).origin;
          const resp = await fetch(`${origin}${imgUrl}`);
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            if (buf.byteLength <= 10 * 1024 * 1024) {
              chosen = candidate;
              const mime = resp.headers.get('content-type') || 'image/jpeg';
              imgSource = { type: 'base64', media_type: mime, data: toB64(buf) };
              break;
            }
          }
        } catch (_) { /* try next */ }
      } else {
        // HTTPS or other URL — fetch in Worker to avoid robots.txt restrictions
        try {
          const resp = await fetch(imgUrl);
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            if (buf.byteLength <= 10 * 1024 * 1024) {
              chosen = candidate;
              const mime = resp.headers.get('content-type') || 'image/jpeg';
              imgSource = { type: 'base64', media_type: mime, data: toB64(buf) };
              break;
            }
          }
        } catch (_) { /* try next */ }
      }
    }
  }
  if (!chosen || !imgSource) {
    const dbg = candidates.map(c => ({ id: c.id, r2: c.r2_key || null, thumb: c.thumbnail || null, url: c.url || null }));
    return jsonRes({ error: 'לא נמצאה תמונה לניתוח', debug: dbg }, 404, request);
  }

  // 3. Ask Claude sonnet for composition rule selection + full analysis
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
          { type: 'image', source: imgSource },
          { type: 'text', text: `אתה מורה לצילום כותב מדריך לצלמן מתחיל על התמונה הזו.

כותרת: ${chosen.title || ''}
תיאור: ${chosen.description || ''}

בחר את חוק הצילום שהתמונה מדגימה הכי ברור מתוך: rule_of_thirds, symmetry, leading_lines, golden_ratio, framing, negative_space

נתח את התמונה והעריך את הגדרות המצלמה הסבירות ביותר לפי מה שניתן לראות בפועל — התחשב בכל ארבעת הפרמטרים: חשיפה, תנועה, רעש, מרחק צילום.

החזר JSON בלבד (ללא markdown), בדיוק במבנה הזה:
{
  "composition_rule": "שם_החוק",
  "annotations": [
    {"x_pct": 0-100, "y_pct": 0-100, "label": "שורה1\\nשורה2", "anchor": "left|right|top|bottom"}
  ],
  "camera_analysis": {
    "aperture": {"value": "f/X.X", "explanation": "הסבר קצר בעברית — מה הצמצם הזה משיג בתמונה הספציפית הזו (לא תמיד בוקה — אם הכל חד, הסבר למה צמצם סגור)"},
    "shutter":  {"value": "1/XXXs", "explanation": "הסבר קצר בעברית"},
    "iso":      {"value": "XXX",    "explanation": "הסבר קצר בעברית"},
    "focal":    {"value": "XXXmm",  "explanation": "הסבר קצר בעברית"}
  },
  "composition_html": "<p><strong>כותרת:</strong> טקסט ראשון...</p><p><strong>כותרת:</strong> טקסט שני...</p><p><strong>כותרת:</strong> טקסט שלישי...</p>",
  "tags": ["תג1", "תג2", "תג3", "תג4"]
}

חוקים:
- annotations: 3-5 נקודות שמדגימות את חוק הצילום. ב-leading_lines: זהה את נקודת המגוז — הנקודה שאליה מתכנסים כל קווי הפרספקטיבה בתמונה (קו גג, קו מדרכה, קו תחתית בניינים). בצילום רחוב היא תמיד בגובה העיניים — y_pct בין 40-60%, לא בחלק העליון או התחתון. הוסף אותה כנקודה עם label "נקודת מגוז", והשאר 2-3 נקודות על אלמנטים חשובים. הקוד יצייר את קווי הפרספקטיבה אוטומטית. בחוקים אחרים: נקודות על אלמנטים רלוונטיים
- composition_html: בדיוק 3 פסקאות עם <strong> בתחילת כל אחת — פסקה 1: מה חוק הקומפוזיציה ואיך הוא מופיע בתמונה הזו ספציפית; פסקה 2: מה עוד מעניין בתמונה מבחינה ויזואלית; פסקה 3: מה הצלמן המתחיל יכול ללמוד מזה
- tags: 4-6 מילים קצרות בעברית
- הכל בעברית` }
        ]
      }]
    })
  });
  if (!analysisRes.ok) {
    const analysisErr = await analysisRes.text().catch(() => '');
    return jsonRes({ error: `Claude API error (analysis) ${analysisRes.status}: ${analysisErr.slice(0, 300)}` }, 502, request);
  }

  let analysis;
  try {
    const analysisJson = await analysisRes.json();
    const raw = analysisJson.content?.[0]?.text?.trim() || '{}';
    analysis = JSON.parse(raw.replace(/```json\n?|\n?```/g, ''));
  } catch (e) {
    return jsonRes({ error: 'Failed to parse Claude response: ' + String(e) }, 502, request);
  }

  // 4. Save to D1
  const rule = analysis.composition_rule || 'rule_of_thirds';
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
const RULE_LABELS_EN = {
  rule_of_thirds: 'Rule of Thirds',
  symmetry: 'Symmetry',
  leading_lines: 'Leading Lines',
  golden_ratio: 'Golden Ratio',
  framing: 'Framing',
  negative_space: 'Negative Space',
};

async function handleLearnIndex(env) {
  // Ensure tags_json_en column exists
  try { await env.DB.prepare('ALTER TABLE photo_analyses ADD COLUMN tags_json_en TEXT DEFAULT \'[]\'').run(); } catch (_) {}

  const { results: analyses } = await env.DB.prepare(
    `SELECT a.photo_id, a.title, a.title_en, a.composition_rule, a.tags_json, a.tags_json_en, a.published_at,
            p.thumbnail
     FROM photo_analyses a
     LEFT JOIN photos p ON p.id = a.photo_id
     ORDER BY a.published_at DESC`
  ).all().catch(() => ({ results: [] }));

  const cards = (analyses || []).map(a => {
    const thumb = a.thumbnail || '';
    const ruleLabelHe = RULE_LABELS[a.composition_rule] || a.composition_rule;
    const ruleLabelEn = RULE_LABELS_EN[a.composition_rule] || a.composition_rule;
    const titleEn = a.title_en || a.title;
    const tagsHe = JSON.parse(a.tags_json || '[]').slice(0, 3);
    const tagsEn = JSON.parse(a.tags_json_en || '[]').slice(0, 3);
    const tags = tagsHe.map((t, i) => {
      const en = tagsEn[i];
      return en
        ? `<span class="tag"><span class="lang-he">${escXml(t)}</span><span class="lang-en" style="display:none">${escXml(en)}</span></span>`
        : `<span class="tag">${escXml(t)}</span>`;
    }).join('');
    const date = a.published_at ? a.published_at.slice(0, 10) : '';
    return `<a class="learn-card" href="/learn/${escXml(a.photo_id)}">
      <img src="${escXml(thumb)}" alt="${escXml(a.title)}" loading="lazy">
      <div class="learn-card-body">
        <div class="learn-card-rule" data-he="${escXml(ruleLabelHe)}" data-en="${escXml(ruleLabelEn)}">${escXml(ruleLabelHe)}</div>
        <div class="learn-card-title" data-he="${escXml(a.title)}" data-en="${escXml(titleEn)}">${escXml(a.title)}</div>
        <div class="learn-card-tags">${tags}</div>
        <div class="learn-card-date">${escXml(date)}</div>
      </div>
    </a>`;
  }).join('\n');

  const empty = analyses.length === 0
    ? '<p style="text-align:center;color:#888;padding:4rem" data-he="הניתוח הראשון יפורסם בקרוב — חזרו מחר!" data-en="First analysis coming soon — check back tomorrow!">הניתוח הראשון יפורסם בקרוב — חזרו מחר!</p>'
    : '';

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ניתוח תמונות — Amit Photos</title>
<meta name="description" content="ניתוח צילומי מעמיק של תמונות אמנות — חוק השליש, בוקה, קומפוזיציה. מדריך לצלמן מתחיל.">
<meta property="og:title" content="📸 ניתוח תמונות | Amit Photos">
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
<script src="/assets/js/nav.js" defer></script>
<script src="/assets/js/share.js" defer></script>
</head>
<body>
<div class="page-hero">
  <h1 data-he="📸 ניתוח תמונות" data-en="📸 Photo Analysis">📸 ניתוח תמונות</h1>
  <p data-he="ניתוח צילומי מעמיק — חוקי קומפוזיציה, הגדרות מצלמה, ומה הצלם חשב" data-en="Deep photographic analysis — composition rules, camera settings, and the photographer's vision">ניתוח צילומי מעמיק — חוקי קומפוזיציה, הגדרות מצלמה, ומה הצלם חשב</p>
</div>
<div class="grid">${cards}${empty}</div>
<div class="back-link nav-prev"><a href="https://amitphotos.com" data-he="← לגלריה המלאה" data-en="← Back to Gallery">← לגלריה המלאה</a></div>
<script>
function getLang(){return localStorage.getItem('lang')||'he'}
function applyLang(){
  const lang=getLang(),isEn=lang==='en';
  document.documentElement.dir=isEn?'ltr':'rtl';
  document.documentElement.lang=lang;
  document.body.style.direction=isEn?'ltr':'rtl';
  document.querySelectorAll('[data-he][data-en]').forEach(el=>{el.textContent=el.dataset[lang]||el.dataset.he});
}
document.addEventListener('DOMContentLoaded',applyLang);
window.addEventListener('storage',e=>{if(e.key==='lang')applyLang()});
</script>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function buildPhysicsDiagram(camera) {
  const gold = '#c8a96e', green = '#4ade80', muted = '#888';
  const apertureVal = parseFloat((camera.aperture?.value || '').replace('f/', ''));
  const focalVal    = parseFloat((camera.focal?.value    || '').replace(/[^0-9.]/g, ''));
  const shutterStr  = camera.shutter?.value || '';
  let shutterSec = null;
  const m1 = shutterStr.match(/^1\/(\d+)/);
  if (m1) shutterSec = 1 / parseInt(m1[1]);
  else { const m2 = shutterStr.match(/^(\d*\.?\d+)/); if (m2) shutterSec = parseFloat(m2[1]); }

  if (!isNaN(apertureVal) && apertureVal <= 4) return {
    title: '📊 עומק שדה ובוקה', titleEn: '📊 Depth of Field & Bokeh',
    svg: `<svg viewBox="0 0 500 180" style="width:100%;max-width:500px;display:block;margin:0 auto">
      <rect x="20" y="65" width="55" height="50" rx="5" fill="#1a1a1a" stroke="${gold}" stroke-width="1.5"/>
      <text x="47" y="94" text-anchor="middle" fill="${gold}" font-size="10" font-family="Heebo" data-he="מצלמה" data-en="Camera">מצלמה</text>
      <ellipse cx="75" cy="90" rx="9" ry="20" fill="#222" stroke="${gold}" stroke-width="1.5"/>
      <line x1="84" y1="72" x2="210" y2="90" stroke="rgba(200,169,110,.7)" stroke-width="1"/>
      <line x1="84" y1="90" x2="210" y2="90" stroke="rgba(200,169,110,.7)" stroke-width="1"/>
      <line x1="84" y1="108" x2="210" y2="90" stroke="rgba(200,169,110,.7)" stroke-width="1"/>
      <line x1="210" y1="0" x2="210" y2="180" stroke="${green}" stroke-width="2" stroke-dasharray="4,3"/>
      <text x="214" y="20" fill="${green}" font-size="10" font-family="Heebo" data-he="נושא (חד)" data-en="Subject (Sharp)">נושא (חד)</text>
      <circle cx="210" cy="90" r="5" fill="${green}"/>
      <line x1="210" y1="90" x2="410" y2="50" stroke="rgba(136,136,136,.5)" stroke-width="1"/>
      <line x1="210" y1="90" x2="410" y2="90" stroke="rgba(136,136,136,.5)" stroke-width="1"/>
      <line x1="210" y1="90" x2="410" y2="130" stroke="rgba(136,136,136,.5)" stroke-width="1"/>
      <line x1="410" y1="0" x2="410" y2="180" stroke="${muted}" stroke-width="1.5" stroke-dasharray="4,3"/>
      <text x="414" y="20" fill="${muted}" font-size="10" font-family="Heebo" data-he="רקע (מטושטש)" data-en="Background (Blurred)">רקע (מטושטש)</text>
      <circle cx="410" cy="50" r="16" fill="none" stroke="rgba(200,169,110,.4)" stroke-width="1.5"/>
      <circle cx="410" cy="90" r="16" fill="none" stroke="rgba(200,169,110,.4)" stroke-width="1.5"/>
      <circle cx="410" cy="130" r="16" fill="none" stroke="rgba(200,169,110,.4)" stroke-width="1.5"/>
      <text x="75" y="158" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="פתח עדשה רחב = עומק שדה רדוד = בוקה" data-en="Wide open aperture = Shallow DOF = Bokeh">פתח עדשה רחב = עומק שדה רדוד = בוקה</text>
    </svg>`
  };

  if (!isNaN(focalVal) && focalVal <= 28) return {
    title: '📊 זווית רחבה ופרספקטיבה', titleEn: '📊 Wide Angle & Perspective',
    svg: `<svg viewBox="0 0 500 180" style="width:100%;max-width:500px;display:block;margin:0 auto">
      <rect x="10" y="70" width="48" height="40" rx="5" fill="#1a1a1a" stroke="${gold}" stroke-width="1.5"/>
      <text x="34" y="93" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="מצלמה" data-en="Camera">מצלמה</text>
      <text x="34" y="105" text-anchor="middle" fill="${gold}" font-size="8" font-family="Heebo">${focalVal}mm</text>
      <line x1="58" y1="90" x2="470" y2="15"  stroke="rgba(200,169,110,.5)" stroke-width="1.5" stroke-dasharray="4,3"/>
      <line x1="58" y1="90" x2="470" y2="165" stroke="rgba(200,169,110,.5)" stroke-width="1.5" stroke-dasharray="4,3"/>
      <rect x="100" y="52" width="18" height="76" rx="3" fill="${green}" opacity="0.85"/>
      <text x="109" y="143" text-anchor="middle" fill="${green}" font-size="9" font-family="Heebo" data-he="קרוב" data-en="Near">קרוב</text>
      <rect x="240" y="72" width="12" height="36" rx="2" fill="${gold}" opacity="0.65"/>
      <text x="246" y="122" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="ביניים" data-en="Mid">ביניים</text>
      <rect x="370" y="83" width="7" height="14" rx="2" fill="${muted}" opacity="0.7"/>
      <text x="374" y="108" text-anchor="middle" fill="${muted}" font-size="9" font-family="Heebo" data-he="רחוק" data-en="Far">רחוק</text>
      <line x1="100" y1="52"  x2="378" y2="81"  stroke="rgba(200,169,110,.3)" stroke-width="1"/>
      <line x1="118" y1="128" x2="378" y2="97" stroke="rgba(200,169,110,.3)" stroke-width="1"/>
      <text x="250" y="170" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="שדה ראייה רחב — קרוב נראה גדול, רחוק קטן → עומק דרמטי" data-en="Wide field of view — near appears large, far small → dramatic depth">שדה ראייה רחב — קרוב נראה גדול, רחוק קטן → עומק דרמטי</text>
    </svg>`
  };

  if (!isNaN(focalVal) && focalVal >= 85) return {
    title: '📊 דחיסת טלה', titleEn: '📊 Telephoto Compression',
    svg: `<svg viewBox="0 0 500 180" style="width:100%;max-width:500px;display:block;margin:0 auto">
      <rect x="10" y="70" width="55" height="40" rx="5" fill="#1a1a1a" stroke="${gold}" stroke-width="1.5"/>
      <text x="37" y="93" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="מצלמה" data-en="Camera">מצלמה</text>
      <text x="37" y="105" text-anchor="middle" fill="${gold}" font-size="8" font-family="Heebo">${focalVal}mm</text>
      <line x1="65" y1="90" x2="460" y2="68"  stroke="rgba(200,169,110,.5)" stroke-width="1.5" stroke-dasharray="4,3"/>
      <line x1="65" y1="90" x2="460" y2="112" stroke="rgba(200,169,110,.5)" stroke-width="1.5" stroke-dasharray="4,3"/>
      <rect x="210" y="72" width="16" height="36" rx="3" fill="${green}" opacity="0.85"/>
      <text x="218" y="122" text-anchor="middle" fill="${green}" font-size="9" font-family="Heebo" data-he="קרוב" data-en="Near">קרוב</text>
      <rect x="320" y="74" width="14" height="32" rx="3" fill="${gold}" opacity="0.7"/>
      <text x="327" y="120" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="רחוק" data-en="Far">רחוק</text>
      <line x1="226" y1="90" x2="318" y2="90" stroke="rgba(200,169,110,.5)" stroke-width="1.5" stroke-dasharray="3,2"/>
      <text x="272" y="84" text-anchor="middle" fill="${muted}" font-size="9" font-family="Heebo" data-he="נראים קרובים" data-en="Appear close">נראים קרובים</text>
      <text x="260" y="170" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="שדה ראייה צר — מרחקים נדחסים, רקע נראה קרוב יותר" data-en="Narrow field of view — distances compressed, background appears closer">שדה ראייה צר — מרחקים נדחסים, רקע נראה קרוב יותר</text>
    </svg>`
  };

  if (shutterSec !== null && shutterSec >= 1/30) return {
    title: '📊 חשיפה ארוכה ותנועה', titleEn: '📊 Long Exposure & Motion',
    svg: `<svg viewBox="0 0 500 180" style="width:100%;max-width:500px;display:block;margin:0 auto">
      <rect x="20" y="70" width="50" height="40" rx="5" fill="#1a1a1a" stroke="${gold}" stroke-width="1.5"/>
      <text x="45" y="93" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="מצלמה" data-en="Camera">מצלמה</text>
      <text x="45" y="105" text-anchor="middle" fill="${gold}" font-size="8" font-family="Heebo">${shutterStr}</text>
      <rect x="200" y="58" width="18" height="64" rx="3" fill="${green}" opacity="0.9"/>
      <text x="209" y="136" text-anchor="middle" fill="${green}" font-size="9" font-family="Heebo" data-he="נייח (חד)" data-en="Stationary (Sharp)">נייח (חד)</text>
      <ellipse cx="370" cy="90" rx="65" ry="14" fill="rgba(200,169,110,.18)" stroke="rgba(200,169,110,.35)" stroke-width="1"/>
      <ellipse cx="335" cy="90" rx="14" ry="14" fill="rgba(200,169,110,.55)"/>
      <text x="370" y="118" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="נע (מטושטש)" data-en="Moving (Blurred)">נע (מטושטש)</text>
      <line x1="200" y1="158" x2="430" y2="158" stroke="${muted}" stroke-width="1.5"/>
      <polygon points="430,154 440,158 430,162" fill="${muted}"/>
      <text x="315" y="172" text-anchor="middle" fill="${muted}" font-size="9" font-family="Heebo" data-he="זמן חשיפה" data-en="Exposure Time">זמן חשיפה</text>
      <text x="250" y="22" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="שאטר פתוח זמן רב → תנועה נרשמת כטשטוש" data-en="Long shutter → motion recorded as blur">שאטר פתוח זמן רב → תנועה נרשמת כטשטוש</text>
    </svg>`
  };

  if (shutterSec !== null && shutterSec <= 1/500) return {
    title: '📊 הקפאת תנועה', titleEn: '📊 Freezing Motion',
    svg: `<svg viewBox="0 0 500 180" style="width:100%;max-width:500px;display:block;margin:0 auto">
      <rect x="20" y="70" width="50" height="40" rx="5" fill="#1a1a1a" stroke="${gold}" stroke-width="1.5"/>
      <text x="45" y="93" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="מצלמה" data-en="Camera">מצלמה</text>
      <text x="45" y="105" text-anchor="middle" fill="${gold}" font-size="8" font-family="Heebo">${shutterStr}</text>
      <line x1="185" y1="90" x2="270" y2="90" stroke="rgba(200,169,110,.3)" stroke-width="6" stroke-linecap="round"/>
      <polygon points="272,85 282,90 272,95" fill="rgba(200,169,110,.4)"/>
      <text x="228" y="60" text-anchor="middle" fill="${muted}" font-size="9" font-family="Heebo" data-he="כיוון תנועה" data-en="Motion direction">כיוון תנועה</text>
      <circle cx="330" cy="90" r="22" fill="none" stroke="${gold}" stroke-width="2"/>
      <circle cx="330" cy="90" r="6"  fill="${gold}"/>
      <text x="330" y="128" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="קפוא ברגע" data-en="Frozen in moment">קפוא ברגע</text>
      <text x="260" y="170" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="שאטר מהיר מאוד = תנועה קפואה לחלוטין" data-en="Very fast shutter = motion completely frozen">שאטר מהיר מאוד = תנועה קפואה לחלוטין</text>
    </svg>`
  };

  return {
    title: '📊 ISO ורעש דיגיטלי', titleEn: '📊 ISO & Digital Noise',
    svg: `<svg viewBox="0 0 500 180" style="width:100%;max-width:500px;display:block;margin:0 auto">
      <text x="120" y="25" text-anchor="middle" fill="${green}" font-size="11" font-family="Heebo" data-he="ISO נמוך (נקי)" data-en="Low ISO (Clean)">ISO נמוך (נקי)</text>
      ${Array.from({length:36},(_,i)=>`<rect x="${40+(i%6)*16}" y="${35+Math.floor(i/6)*16}" width="13" height="13" rx="1" fill="rgba(74,222,128,.7)" stroke="rgba(74,222,128,.3)" stroke-width=".5"/>`).join('')}
      <text x="370" y="25" text-anchor="middle" fill="#ef4444" font-size="11" font-family="Heebo" data-he="ISO גבוה (רעש)" data-en="High ISO (Noisy)">ISO גבוה (רעש)</text>
      ${Array.from({length:36},(_,i)=>{const c=['rgba(239,68,68,.8)','rgba(200,169,110,.6)','rgba(136,136,136,.9)','rgba(239,68,68,.4)','rgba(74,222,128,.5)'];return`<rect x="${290+(i%6)*16}" y="${35+Math.floor(i/6)*16}" width="13" height="13" rx="1" fill="${c[(i*37+13)%5]}" stroke="rgba(0,0,0,.3)" stroke-width=".5"/>`;}).join('')}
      <line x1="200" y1="80" x2="273" y2="80" stroke="${muted}" stroke-width="1.5"/>
      <polygon points="273,76 283,80 273,84" fill="${muted}"/>
      <text x="237" y="73" text-anchor="middle" fill="${muted}" font-size="9" font-family="Heebo" data-he="ISO עולה" data-en="ISO increases">ISO עולה</text>
      <text x="250" y="168" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="רגישות גבוהה לאור = יותר רעש בפיקסלים" data-en="Higher light sensitivity = more pixel noise">רגישות גבוהה לאור = יותר רעש בפיקסלים</text>
    </svg>`
  };
}

function buildRuleOverlay(rule, annotations) {
  const red = '#e05555';
  const dash = '5,5';
  if (rule === 'rule_of_thirds') return `
    <line x1="33.3%" y1="0" x2="33.3%" y2="100%" stroke="${red}" stroke-width="0.6" stroke-dasharray="${dash}" opacity="0.85"/>
    <line x1="66.6%" y1="0" x2="66.6%" y2="100%" stroke="${red}" stroke-width="0.6" stroke-dasharray="${dash}" opacity="0.85"/>
    <line x1="0" y1="33.3%" x2="100%" y2="33.3%" stroke="${red}" stroke-width="0.6" stroke-dasharray="${dash}" opacity="0.85"/>
    <line x1="0" y1="66.6%" x2="100%" y2="66.6%" stroke="${red}" stroke-width="0.6" stroke-dasharray="${dash}" opacity="0.85"/>
    <circle cx="33.3%" cy="33.3%" r="1.5" fill="${red}" opacity="0.7"/>
    <circle cx="66.6%" cy="33.3%" r="1.5" fill="${red}" opacity="0.7"/>
    <circle cx="33.3%" cy="66.6%" r="1.5" fill="${red}" opacity="0.7"/>
    <circle cx="66.6%" cy="66.6%" r="1.5" fill="${red}" opacity="0.7"/>`;
  if (rule === 'symmetry') return `
    <line x1="50%" y1="0" x2="50%" y2="100%" stroke="${red}" stroke-width="0.6" stroke-dasharray="${dash}" opacity="0.85"/>`;
  if (rule === 'leading_lines') {
    // If explicit line/arrow annotations already exist, skip the auto overlay
    if (annotations.some(a => a.type === 'line' || a.type === 'arrow')) return '';
    const vp = annotations.find(a => !a.type && a.label && (a.label.includes('מגוז') || a.label.includes('התכנסות'))) || annotations.find(a => !a.type);
    if (vp) {
      const vx = parseFloat(vp.x_pct) ?? 80;
      const vy = parseFloat(vp.y_pct) ?? 50;
      const fromLeft = vx >= 50;
      const sx = fromLeft ? 0 : 100;
      const lines = [-35, -12, 12, 35].map(off => {
        const sy = Math.max(2, Math.min(98, vy + off));
        return `<line x1="${sx}%" y1="${sy}%" x2="${vx}%" y2="${vy}%" stroke="${red}" stroke-width="0.6" opacity="0.85" stroke-linecap="round"/>`;
      }).join('');
      return `<g>${lines}</g>`;
    }
    return `<g stroke="${red}" fill="${red}" opacity="0.85">
      <line x1="5%" y1="95%" x2="60%" y2="30%" stroke-width="0.6"/>
      <polygon points="60%,25% 57%,35% 63%,35%"/>
    </g>`;
  }
  if (rule === 'framing') return `
    <rect x="10%" y="10%" width="80%" height="80%" fill="none" stroke="${red}" stroke-width="0.6" stroke-dasharray="${dash}" opacity="0.85"/>`;
  if (rule === 'negative_space') return `
    <rect x="0" y="0" width="40%" height="100%" fill="rgba(224,85,85,0.07)"/>`;
  if (rule === 'golden_ratio') {
    const g = 0.618;
    return `
    <g stroke="${red}" fill="none" stroke-width="0.6" opacity="0.85">
      <rect x="0" y="0" width="100%" height="100%" fill="none" stroke-dasharray="4,4" opacity="0.5"/>
      <line x1="${g*100}%" y1="0" x2="${g*100}%" y2="100%" stroke-dasharray="4,4"/>
      <path d="M ${g*100}%,0 A ${g*100}%,100% 0 0 0 0,100%"/>
      <path d="M 0,${g*100}% A ${(1-g)*100}%,${(1-g)*100}% 0 0 1 ${(1-g)*100}%,100%"/>
      <path d="M ${(1-g)*100}%,${g*(1-g)*100}% A ${g*(1-g)*100}%,${g*(1-g)*100}% 0 0 0 0,${g*(1-g)*100}%"/>
    </g>`;
  }
  return '';
}

function buildAnnotationSVGLines(annotations) {
  const lineAnns = annotations.filter(a => a.type === 'line' || a.type === 'arrow');
  if (!lineAnns.length) return '';
  const gold = '#c8a96e';
  const defs = `<defs>
    <marker id="pw-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${gold}"/>
    </marker>
  </defs>`;
  const els = lineAnns.map(ann => {
    const idx = annotations.indexOf(ann);
    const x1 = parseFloat(ann.x1_pct) || 0, y1 = parseFloat(ann.y1_pct) || 0;
    const x2 = parseFloat(ann.x2_pct) || 0, y2 = parseFloat(ann.y2_pct) || 0;
    const arrowAttr = ann.type === 'arrow' ? ` marker-end="url(#pw-arr)"` : '';
    return `<line data-ann-idx="${idx}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${gold}" stroke-width="0.8" stroke-linecap="round"${arrowAttr} style="opacity:0;transition:opacity .4s"/>`;
  }).join('\n');
  return defs + els;
}

function buildAnnotationLabels(annotations) {
  return annotations.filter(a => (a.type === 'line' || a.type === 'arrow') && a.label).map(ann => {
    const idx = annotations.indexOf(ann);
    const x1 = parseFloat(ann.x1_pct) || 0, y1 = parseFloat(ann.y1_pct) || 0;
    const x2 = parseFloat(ann.x2_pct) || 0, y2 = parseFloat(ann.y2_pct) || 0;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const labelContent = ann.label_en
      ? `<span class="lang-he">${escXml(ann.label)}</span><span class="lang-en" style="display:none">${escXml(ann.label_en)}</span>`
      : escXml(ann.label);
    return `<div data-ann-idx="${idx}" style="position:absolute;left:${mx}%;top:${my}%;transform:translate(-50%,-130%);background:rgba(0,0,0,.85);border:1px solid rgba(200,169,110,.4);border-radius:6px;padding:3px 8px;font-size:.68rem;color:#f0ede8;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .4s">${labelContent}</div>`;
  }).join('\n');
}

function buildAnnotations(annotations) {
  return annotations.filter(a => a.type !== 'line' && a.type !== 'arrow').map((ann, _) => {
    const idx = annotations.indexOf(ann);
    const x = parseFloat(ann.x_pct) || 0;
    const y = parseFloat(ann.y_pct) || 0;
    const anchorClass = `ann-${ann.anchor || 'right'}`;
    const labelHe = (ann.label || '').split('\n').map(l => escXml(l)).join('<br>');
    const labelContent = ann.label_en
      ? `<span class="lang-he">${labelHe}</span><span class="lang-en" style="display:none">${ann.label_en.split('\n').map(l => escXml(l)).join('<br>')}</span>`
      : labelHe;
    return `<div class="ann" data-ann-idx="${idx}" style="left:${x}%;top:${y}%;opacity:0;transition:opacity .4s">
      <div class="ann-dot"></div>
      <div class="ann-label ${anchorClass}">${labelContent}</div>
    </div>`;
  }).join('\n');
}

async function handleLearnAnalysis(env, photoId) {
  const row = await env.DB.prepare(
    'SELECT * FROM photo_analyses WHERE photo_id = ?'
  ).bind(photoId).first().catch(() => null);

  const photo = await env.DB.prepare(
    'SELECT id, title, thumbnail, url FROM photos WHERE id = ?'
  ).bind(photoId).first().catch(() => null);

  if (!row || !photo) {
    return new Response(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>לא נמצא</title><style>body{background:#0a0a0a;color:#f0ede8;font-family:'Heebo',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:1rem}</style></head><body><h1 style="color:#c8a96e;font-size:2rem">404</h1><p>הניתוח לא נמצא</p><a href="/learn/" style="color:#c8a96e">← חזרה לניתוח תמונות</a></body></html>`, {status: 404, headers: {'Content-Type': 'text/html;charset=utf-8'}});
  }

  // Prev/next and more analyses — run in parallel
  const [prevRow, nextRow, moreRows] = await Promise.all([
    env.DB.prepare(`SELECT a.photo_id, a.title, a.title_en FROM photo_analyses a WHERE a.published_at > ? AND a.published_at IS NOT NULL ORDER BY a.published_at ASC LIMIT 1`).bind(row.published_at || '').first().catch(() => null),
    env.DB.prepare(`SELECT a.photo_id, a.title, a.title_en FROM photo_analyses a WHERE a.published_at < ? AND a.published_at IS NOT NULL ORDER BY a.published_at DESC LIMIT 1`).bind(row.published_at || '').first().catch(() => null),
    env.DB.prepare(`SELECT a.photo_id, a.title, a.title_en, a.composition_rule, p.thumbnail, p.url FROM photo_analyses a LEFT JOIN photos p ON p.id = a.photo_id WHERE a.photo_id != ? AND a.published_at IS NOT NULL ORDER BY RANDOM() LIMIT 4`).bind(photoId).all().catch(() => ({ results: [] })),
  ]);
  const moreAnalyses = moreRows?.results || [];

  let annotations = [], camera = {}, cameraEn = {}, tags = [];
  try { annotations = JSON.parse(row.annotations_json || '[]'); } catch (_) { annotations = []; }
  try { camera = JSON.parse(row.camera_json || '{}'); } catch (_) { camera = {}; }
  try { cameraEn = JSON.parse(row.camera_json_en || '{}'); } catch (_) { cameraEn = {}; }
  try { tags = JSON.parse(row.tags_json || '[]'); } catch (_) { tags = []; }
  const ruleLabelHe = RULE_LABELS[row.composition_rule] || row.composition_rule;
  const ruleLabelEn = RULE_LABELS_EN[row.composition_rule] || row.composition_rule;
  const titleEn = row.title_en || row.title;
  const imgUrl = (photo.url || photo.thumbnail || '') + '?w=900';
  const buyUrl = `https://amitphotos.com/?photo=${encodeURIComponent(photoId)}`;

  const labelsHe = { aperture: 'צמצם', shutter: 'מהירות תריס', iso: 'ISO', focal: 'מרחק מוקד' };
  const labelsEn = { aperture: 'Aperture', shutter: 'Shutter Speed', iso: 'ISO', focal: 'Focal Length' };
  const cameraCards = ['aperture', 'shutter', 'iso', 'focal'].map(key => {
    const c = camera[key] || {};
    const cEn = cameraEn[key] || {};
    const descEn = cEn.explanation || c.explanation || '';
    return `<div class="cam-card">
      <div class="cam-label" data-he="${escXml(labelsHe[key])}" data-en="${escXml(labelsEn[key])}">${escXml(labelsHe[key])}</div>
      <div class="cam-value">${escXml(c.value || '—')}</div>
      <div class="cam-desc lang-he">${escXml(c.explanation || '')}</div>
      <div class="cam-desc lang-en" style="display:none">${escXml(descEn)}</div>
    </div>`;
  }).join('\n');

  const tagPills = tags.map(t => `<span class="tag">${escXml(t)}</span>`).join('');

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escXml(row.title)} — ניתוח צילום | Amit Photos</title>
<meta name="description" content="ניתוח צילומי של &quot;${escXml(row.title)}&quot; — ${escXml(ruleLabelHe)}, הגדרות מצלמה, ופירוש הקומפוזיציה.">
<meta property="og:title" content="📸 ${escXml(row.title)} | ניתוח צילום">
<meta property="og:description" content="ניתוח ${escXml(ruleLabelHe)} — הגדרות מצלמה ופירוש הקומפוזיציה. מדריך לצלמן מתחיל.">
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
.page-header{padding:1.5rem 1.25rem .5rem;max-width:900px;margin:0 auto;display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:.5rem}
.page-title{font-family:'Syne',sans-serif;font-size:1.4rem;color:var(--text)}
.rule-badge{font-size:.72rem;color:var(--accent);background:rgba(200,169,110,.1);border:1px solid rgba(200,169,110,.25);border-radius:4px;padding:3px 9px;margin-top:.3rem;display:inline-block}
.buy-btn{background:var(--accent);color:#000;font-weight:700;font-size:.82rem;border-radius:8px;padding:.5rem 1rem;text-decoration:none;white-space:nowrap;flex-shrink:0}
.photo-wrap{position:relative;max-width:900px;margin:0 auto 1.5rem;padding:0 .75rem}
.photo-wrap img{width:100%;border-radius:10px;display:block}
.rule-overlay{position:absolute;top:.75rem;left:.75rem;right:.75rem;bottom:0;width:calc(100% - 1.5rem);height:100%;pointer-events:none}
.ann{position:absolute;transform:translate(-50%,-50%);pointer-events:none;opacity:0;transition:opacity .4s}
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
.analysis-nav{display:flex;justify-content:space-between;align-items:center;max-width:900px;margin:0 auto 2rem;padding:0 .75rem;gap:.5rem}
.analysis-nav a{display:flex;flex-direction:column;gap:.2rem;padding:.6rem 1rem;background:var(--surface);border:1px solid var(--border);border-radius:8px;text-decoration:none;flex:1;max-width:45%;transition:border-color .2s}
.analysis-nav a:hover{border-color:var(--accent)}
.analysis-nav .nav-dir{font-size:.68rem;color:var(--muted)}
.analysis-nav .nav-title{font-size:.82rem;color:var(--text);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.analysis-nav .nav-next{text-align:right}
.analysis-nav .nav-older{text-align:left}
.more-section{max-width:900px;margin:0 auto 2rem;padding:0 .75rem}
.more-section h2{font-family:'Syne',sans-serif;color:var(--accent);font-size:1.05rem;margin-bottom:.75rem}
.more-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem}
@media(min-width:600px){.more-grid{grid-template-columns:repeat(4,1fr)}}
.more-card{display:block;text-decoration:none;background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden;transition:border-color .2s}
.more-card:hover{border-color:var(--accent)}
.more-card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}
.more-card-body{padding:.5rem .6rem}
.more-card-rule{font-size:.65rem;color:var(--accent);margin-bottom:.2rem}
.more-card-title{font-size:.78rem;color:var(--text);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
</style>
<script src="/assets/js/nav.js" defer></script>
<script src="/assets/js/share.js" defer></script>
</head>
<body>
<div class="page-header">
  <div>
    <h1 class="page-title" data-he="${escXml(row.title)}" data-en="${escXml(titleEn)}">${escXml(row.title)}</h1>
    <span class="rule-badge" data-he="${escXml(ruleLabelHe)}" data-en="${escXml(ruleLabelEn)}">${escXml(ruleLabelHe)}</span>
  </div>
  <a class="buy-btn" href="${escXml(buyUrl)}" data-he="רכוש תמונה זו ←" data-en="Buy This Photo ←">רכוש תמונה זו ←</a>
</div>

<div class="photo-wrap">
  <img src="${escXml(imgUrl)}" alt="${escXml(row.title)}">
  <svg class="rule-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    ${buildRuleOverlay(row.composition_rule, annotations)}
    ${buildAnnotationSVGLines(annotations)}
  </svg>
  ${buildAnnotations(annotations)}
  ${buildAnnotationLabels(annotations)}
</div>
${annotations.length > 0 ? `<div style="text-align:center;margin-top:.5rem;margin-bottom:.5rem;min-height:2rem">
  <button id="ann-hide-btn" onclick="annHideAll()" style="display:none;background:rgba(200,169,110,.1);border:1px solid rgba(200,169,110,.3);color:#c8a96e;border-radius:20px;padding:.35rem 1.2rem;font-family:'Heebo',sans-serif;font-size:.82rem;cursor:pointer" data-he="הסתר ביאורים" data-en="Hide Annotations">הסתר ביאורים</button>
</div>` : ''}

<div class="cam-cards">${cameraCards}</div>

${(() => { const d = buildPhysicsDiagram(camera); return `<div class="section"><h2 data-he="${escXml(d.title)}" data-en="${escXml(d.titleEn||d.title)}">${escXml(d.title)}</h2><div class="bokeh-box">${d.svg}</div></div>`; })()}

<div class="section">
  <h2 data-he="🎨 ניתוח קומפוזיציה" data-en="🎨 Composition Analysis">🎨 ניתוח קומפוזיציה</h2>
  <div class="comp-box">
    <div class="lang-he">${String(row.composition_html || '').replace(/<(?!\/?(?:p|strong|em|br|span|div)\b)[^>]*>/gi, '')}</div>
    <div class="lang-en" style="display:none">${String(row.composition_html_en || row.composition_html || '').replace(/<(?!\/?(?:p|strong|em|br|span|div)\b)[^>]*>/gi, '')}</div>
    <div class="tags-row">${tagPills}</div>
  </div>
</div>

${(prevRow || nextRow) ? `
<div class="analysis-nav">
  ${prevRow ? `<a href="/learn/${escXml(prevRow.photo_id)}" class="nav-next"><span class="nav-dir" data-he="← ניתוח חדש יותר" data-en="← Newer Analysis">← ניתוח חדש יותר</span><span class="nav-title" data-he="${escXml(prevRow.title)}" data-en="${escXml(prevRow.title_en||prevRow.title)}">${escXml(prevRow.title)}</span></a>` : '<span></span>'}
  ${nextRow ? `<a href="/learn/${escXml(nextRow.photo_id)}" class="nav-older"><span class="nav-dir" data-he="ניתוח קודם →" data-en="Older Analysis →">ניתוח קודם →</span><span class="nav-title" data-he="${escXml(nextRow.title)}" data-en="${escXml(nextRow.title_en||nextRow.title)}">${escXml(nextRow.title)}</span></a>` : '<span></span>'}
</div>` : ''}

${moreAnalyses.length > 0 ? `
<div class="more-section">
  <h2 data-he="📸 ניתוחים נוספים" data-en="📸 More Analyses">📸 ניתוחים נוספים</h2>
  <div class="more-grid">
    ${moreAnalyses.map(a => {
      const thumb = (a.thumbnail || a.url || '') + '?w=300';
      const labelHe = RULE_LABELS[a.composition_rule] || a.composition_rule || '';
      const labelEn = RULE_LABELS_EN[a.composition_rule] || a.composition_rule || '';
      const aTitleEn = a.title_en || a.title;
      return `<a class="more-card" href="/learn/${escXml(a.photo_id)}">
        <img src="${escXml(thumb)}" alt="${escXml(a.title)}" loading="lazy">
        <div class="more-card-body">
          <div class="more-card-rule" data-he="${escXml(labelHe)}" data-en="${escXml(labelEn)}">${escXml(labelHe)}</div>
          <div class="more-card-title" data-he="${escXml(a.title)}" data-en="${escXml(aTitleEn)}">${escXml(a.title)}</div>
        </div>
      </a>`;
    }).join('')}
  </div>
</div>` : ''}

<div class="nav-row nav-prev">
  <a href="/learn/" data-he="← כל הניתוחים" data-en="← All Analyses">← כל הניתוחים</a>
  <a href="${escXml(buyUrl)}" data-he="רכוש תמונה זו" data-en="Buy This Photo">רכוש תמונה זו</a>
  <a href="https://amitphotos.com" data-he="לגלריה" data-en="Gallery">לגלריה</a>
</div>
<script>
function getLang(){return localStorage.getItem('lang')||'he'}
function applyLang(){
  const lang=getLang(),isEn=lang==='en';
  document.documentElement.dir=isEn?'ltr':'rtl';
  document.documentElement.lang=lang;
  document.body.style.direction=isEn?'ltr':'rtl';
  document.querySelectorAll('[data-he][data-en]').forEach(el=>{el.textContent=el.dataset[lang]||el.dataset.he});
  document.querySelectorAll('.lang-he,.lang-en').forEach(el=>{
    el.style.display=el.classList.contains('lang-'+lang)?'':'none';
  });
}
document.addEventListener('DOMContentLoaded',applyLang);
window.addEventListener('storage',e=>{if(e.key==='lang')applyLang()});
(function() {
  const all = document.querySelectorAll('[data-ann-idx]');
  if (!all.length) return;
  const byIdx = {};
  all.forEach(el => {
    const i = el.dataset.annIdx;
    if (!byIdx[i]) byIdx[i] = [];
    byIdx[i].push(el);
  });
  const indices = Object.keys(byIdx).map(Number).sort((a, b) => a - b);
  const hideBtn = document.getElementById('ann-hide-btn');
  indices.forEach((idx, step) => {
    setTimeout(() => {
      byIdx[idx].forEach(el => { el.style.opacity = '1'; });
      if (step === indices.length - 1 && hideBtn) hideBtn.style.display = 'inline-block';
    }, 700 + step * 2000);
  });
  window.annHideAll = function() {
    all.forEach(el => { el.style.opacity = '0'; });
    if (hideBtn) hideBtn.style.display = 'none';
  };
})();
</script>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ===== LOCATIONS API =====

async function handleLocationsList(request, env) {
  const { results } = await env.DB.prepare(`
    SELECT l.id, l.title, l.title_en, l.region, l.best_time, l.best_time_en, l.coordinates,
           lp.url AS cover_url, lp.thumbnail AS cover_thumb
    FROM locations l
    LEFT JOIN location_photos lp ON lp.location_id = l.id AND lp.sort_order = (
      SELECT MIN(sort_order) FROM location_photos WHERE location_id = l.id
    )
    WHERE l.published = 1
    ORDER BY l.created_at DESC
  `).all();
  return jsonRes(results || [], 200, request);
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function handleLocationsGet(request, env, slug) {
  const loc = await env.DB.prepare(
    'SELECT * FROM locations WHERE id = ? AND published = 1'
  ).bind(slug).first();
  if (!loc) return jsonRes({ error: 'לא נמצא' }, 404, request);

  const { results: photos } = await env.DB.prepare(
    'SELECT * FROM location_photos WHERE location_id = ? ORDER BY sort_order ASC'
  ).bind(slug).all();

  // Compute nearby (up to 3 closest published locations with coordinates)
  let nearby = [];
  if (loc.coordinates) {
    const [lat, lng] = loc.coordinates.split(',').map(s => parseFloat(s.trim()));
    if (!isNaN(lat) && !isNaN(lng)) {
      const { results: others } = await env.DB.prepare(
        "SELECT l.id, l.title, l.title_en, l.coordinates, (SELECT lp.thumbnail FROM location_photos lp WHERE lp.location_id = l.id ORDER BY lp.sort_order ASC LIMIT 1) AS cover_thumb FROM locations l WHERE l.published = 1 AND l.id != ? AND l.coordinates IS NOT NULL AND l.coordinates != ''"
      ).bind(slug).all();
      nearby = (others || [])
        .map(o => {
          const [olat, olng] = o.coordinates.split(',').map(s => parseFloat(s.trim()));
          return isNaN(olat) ? null : { id: o.id, title: o.title, title_en: o.title_en || null, cover_thumb: o.cover_thumb, km: Math.round(haversineKm(lat, lng, olat, olng)) };
        })
        .filter(Boolean)
        .sort((a, b) => a.km - b.km)
        .slice(0, 3);
    }
  }

  const safeJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
  return jsonRes({
    ...loc,
    related_guides:      safeJson(loc.related_guides, []),
    extra_links:         safeJson(loc.extra_links, []),
    when_to_visit:       safeJson(loc.when_to_visit, null),
    recommended_gear:    safeJson(loc.recommended_gear, null),
    when_to_visit_en:    safeJson(loc.when_to_visit_en, null),
    recommended_gear_en: safeJson(loc.recommended_gear_en, null),
    nearby,
    photos: photos || []
  }, 200, request);
}

async function handleLocationsSuggest(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);
  if (!env.RESEND_API_KEY) return jsonRes({ error: 'RESEND_API_KEY חסר' }, 500, request);

  const { type, location_slug, sender_name, message } = await request.json().catch(() => ({}));
  if (!message || !message.trim()) return jsonRes({ error: 'הודעה ריקה' }, 400, request);

  const isNew = type === 'new';
  const subject = isNew
    ? `הצעת מקום חדש${sender_name ? ` מ-${sender_name}` : ''}`
    : `תיקון למקום: ${location_slug}${sender_name ? ` מ-${sender_name}` : ''}`;

  const html = `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
    <h2 style="color:#c8a96e">${subject}</h2>
    ${sender_name ? `<p><strong>שם:</strong> ${sender_name}</p>` : ''}
    ${!isNew ? `<p><strong>מקום:</strong> ${location_slug}</p>` : ''}
    <p><strong>הודעה:</strong></p>
    <p style="background:#111;padding:1rem;border-radius:4px;white-space:pre-wrap">${message}</p>
  </div>`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Amit Photos <onboarding@resend.dev>', to: ['erez.family@gmail.com'], subject, html })
  });
  if (!emailRes.ok) return jsonRes({ error: 'שגיאה בשליחת המייל' }, 502, request);

  return jsonRes({ ok: true }, 200, request);
}

// ===== ADMIN LOCATIONS CRUD =====

async function enrichLocationWithAI(locationName, env) {
  if (!env.ANTHROPIC_API_KEY) return null;

  const GUIDE_PATHS = [
    '/camera/filters/', '/camera/composition/', '/camera/exposure/',
    '/camera/depth-of-field/', '/camera/white-balance/', '/camera/histogram/',
    '/camera/light/', '/camera/dynamic-range/', '/camera/controls/',
    '/camera/lenses/', '/camera/types/'
  ];

  const prompt = `You are helping a professional Israeli photographer catalog shooting locations.
For the location "${locationName}", return a JSON object with these fields:
- description: 2-3 sentences in Hebrew about the location and its photographic qualities
- best_time: best time(s) to photograph there (Hebrew, e.g. "זריחה — שעת הזהב")
- equipment: recommended camera equipment (Hebrew, e.g. "חצובה, עדשה 14-24mm, פילטר ND")
- my_tip: one personal photography tip in Hebrew, first person (e.g. "אני ממליץ להגיע...")
- coordinates: "lat,lng" GPS string for this location (e.g. "31.7683,35.2137"). For international locations use real GPS.
- related_guides: array of 1-3 paths from this list that are most relevant: ${JSON.stringify(GUIDE_PATHS)}
- when_to_visit: object with keys "summer","fall","winter","spring". Each value: {"rating":"good"|"ok"|"bad","note":"one short Hebrew sentence about light/weather/crowds"}
- recommended_gear: array of objects [{name:"Hebrew gear name", primary:true|false}]. Mark the single most important lens/item as primary:true. 3-6 items total.

Return ONLY valid JSON, no markdown fences, no extra text.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('Anthropic API error:', res.status, errText.slice(0, 300));
      return null;
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text || '';
    // Strip markdown fences if present
    const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('enrichLocationWithAI error:', e?.message);
    return null;
  }
}

async function handleAdminLocationsList(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { results } = await env.DB.prepare(`
    SELECT l.id, l.title, l.title_en, l.region, l.published,
           COUNT(lp.id) AS photo_count
    FROM locations l
    LEFT JOIN location_photos lp ON lp.location_id = l.id
    GROUP BY l.id
    ORDER BY l.created_at DESC
  `).all();
  return jsonRes(results || [], 200, request);
}

async function handleAdminLocationsCreate(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);

  const { title, region } = await request.json().catch(() => ({}));
  if (!title || !title.trim()) return jsonRes({ error: 'כותרת חסרה' }, 400, request);

  const id = slugify(title);
  const now = new Date().toISOString();

  const existing = await env.DB.prepare('SELECT id FROM locations WHERE id = ?').bind(id).first();
  if (existing) return jsonRes({ error: `slug "${id}" כבר קיים` }, 409, request);

  await env.DB.prepare(
    'INSERT INTO locations (id, title, region, published, created_at) VALUES (?,?,?,0,?)'
  ).bind(id, title.trim(), region || '', now).run();

  const enriched = await enrichLocationWithAI(title, env);
  if (enriched) {
    await env.DB.prepare(`
      UPDATE locations SET
        description = ?, best_time = ?, equipment = ?,
        my_tip = ?, coordinates = ?, related_guides = ?,
        when_to_visit = ?, recommended_gear = ?
      WHERE id = ?
    `).bind(
      enriched.description || '',
      enriched.best_time || '',
      enriched.equipment || '',
      enriched.my_tip || '',
      enriched.coordinates || '',
      JSON.stringify(enriched.related_guides || []),
      enriched.when_to_visit ? JSON.stringify(enriched.when_to_visit) : null,
      enriched.recommended_gear ? JSON.stringify(enriched.recommended_gear) : null,
      id
    ).run();
  }

  const loc = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(id).first();
  const safeJson = (s, fb) => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };
  return jsonRes({ ...loc, related_guides: safeJson(loc.related_guides, []) }, 201, request);
}

async function handleAdminLocationsUpdate(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'PUT') return jsonRes({ error: 'PUT only' }, 405, request);

  const body = await request.json().catch(() => ({}));
  const fields = [
    'title','region','description','best_time','equipment','my_tip','coordinates','published',
    'when_to_visit','recommended_gear',
    'title_en','description_en','best_time_en','equipment_en','my_tip_en'
  ];
  const sets = [];
  const vals = [];

  for (const f of fields) {
    if (body[f] !== undefined) {
      sets.push(`${f} = ?`);
      vals.push(f === 'published' ? (body[f] ? 1 : 0) : body[f]);
    }
  }
  if (body.related_guides !== undefined) {
    sets.push('related_guides = ?');
    vals.push(JSON.stringify(body.related_guides));
  }
  if (body.extra_links !== undefined) {
    sets.push('extra_links = ?');
    vals.push(JSON.stringify(body.extra_links));
  }
  if (body.when_to_visit_en !== undefined) {
    sets.push('when_to_visit_en = ?');
    vals.push(body.when_to_visit_en);
  }
  if (body.recommended_gear_en !== undefined) {
    sets.push('recommended_gear_en = ?');
    vals.push(body.recommended_gear_en);
  }

  if (sets.length === 0) return jsonRes({ error: 'אין שדות לעדכון' }, 400, request);

  const exists = await env.DB.prepare('SELECT id FROM locations WHERE id = ?').bind(slug).first();
  if (!exists) return jsonRes({ error: 'לא נמצא' }, 404, request);

  vals.push(slug);
  await env.DB.prepare(`UPDATE locations SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  const loc = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(slug).first();
  if (!loc) return jsonRes({ error: 'לא נמצא' }, 404, request);
  const safeJson = (s, fb) => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };
  return jsonRes({ ...loc, related_guides: safeJson(loc.related_guides, []), extra_links: safeJson(loc.extra_links, []) }, 200, request);
}

async function handleAdminLocationsDelete(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'DELETE') return jsonRes({ error: 'DELETE only' }, 405, request);

  const { results: exclusivePhotos } = await env.DB.prepare(
    "SELECT r2_key FROM location_photos WHERE location_id = ? AND type = 'exclusive' AND r2_key IS NOT NULL"
  ).bind(slug).all();
  for (const p of exclusivePhotos || []) {
    await env.PHOTOS.delete(p.r2_key).catch(() => {});
  }

  await env.DB.prepare('DELETE FROM location_photos WHERE location_id = ?').bind(slug).run();
  await env.DB.prepare('DELETE FROM locations WHERE id = ?').bind(slug).run();
  return jsonRes({ ok: true }, 200, request);
}

async function handleAdminLocationsEnrich(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);

  const loc = await env.DB.prepare('SELECT title FROM locations WHERE id = ?').bind(slug).first();
  if (!loc) return jsonRes({ error: 'לא נמצא' }, 404, request);

  const enriched = await enrichLocationWithAI(loc.title, env);
  if (!enriched) return jsonRes({ error: 'AI enrich נכשל' }, 500, request);

  await env.DB.prepare(`
    UPDATE locations SET
      description = ?, best_time = ?, equipment = ?,
      my_tip = ?, coordinates = ?, related_guides = ?,
      when_to_visit = ?, recommended_gear = ?
    WHERE id = ?
  `).bind(
    enriched.description || '',
    enriched.best_time || '',
    enriched.equipment || '',
    enriched.my_tip || '',
    enriched.coordinates || '',
    JSON.stringify(enriched.related_guides || []),
    enriched.when_to_visit ? JSON.stringify(enriched.when_to_visit) : null,
    enriched.recommended_gear ? JSON.stringify(enriched.recommended_gear) : null,
    slug
  ).run();

  const updated = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(slug).first();
  return jsonRes({
    ...updated,
    related_guides: JSON.parse(updated.related_guides || '[]'),
    extra_links: JSON.parse(updated.extra_links || '[]'),
    when_to_visit: updated.when_to_visit ? JSON.parse(updated.when_to_visit) : null,
    recommended_gear: updated.recommended_gear ? JSON.parse(updated.recommended_gear) : null
  }, 200, request);
}

async function handleAdminLocationsGet(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  const loc = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(slug).first();
  if (!loc) return jsonRes({ error: 'לא נמצא' }, 404, request);
  const { results: photos } = await env.DB.prepare(
    'SELECT * FROM location_photos WHERE location_id = ? ORDER BY sort_order ASC'
  ).bind(slug).all();
  const safeJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
  return jsonRes({
    ...loc,
    related_guides:     safeJson(loc.related_guides, []),
    extra_links:        safeJson(loc.extra_links, []),
    when_to_visit:      safeJson(loc.when_to_visit, null),
    recommended_gear:   safeJson(loc.recommended_gear, null),
    when_to_visit_en:   safeJson(loc.when_to_visit_en, null),
    recommended_gear_en: safeJson(loc.recommended_gear_en, null),
    photos: photos || []
  }, 200, request);
}

async function handleAdminLocationsGenerateEn(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: 'ANTHROPIC_API_KEY חסר' }, 500, request);

  const loc = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(slug).first();
  if (!loc) return jsonRes({ error: 'לא נמצא' }, 404, request);

  const prompt = `You are Amit Erez, an Israeli travel photographer writing for an international photography audience.
Translate and adapt the following Hebrew photography location data to English. Write in first person, personal and inspiring tone, as if you visited this place yourself and want to help other photographers get the best shots.

Location data:
Title: ${loc.title}
Region: ${loc.region}
Description: ${loc.description || ''}
Best time to visit: ${loc.best_time || ''}
Equipment: ${loc.equipment || ''}
My tip: ${loc.my_tip || ''}
When to visit (JSON): ${loc.when_to_visit || 'null'}
Recommended gear (JSON): ${loc.recommended_gear || 'null'}

Return ONLY valid JSON with these exact keys — no markdown, no explanation:
{
  "title_en": "English title",
  "description_en": "Full adapted English description (3-5 sentences, vivid and location-specific)",
  "best_time_en": "Best time in English",
  "equipment_en": "Equipment in English",
  "my_tip_en": "Personal shooting tip in English",
  "when_to_visit_en": {"summer":{"rating":"ok","note":"English note"},"fall":{"rating":"good","note":"English note"},"winter":{"rating":"ok","note":"English note"},"spring":{"rating":"good","note":"English note"}},
  "recommended_gear_en": [{"name":"English gear name","primary":true}]
}

Rules:
- For when_to_visit_en: keep the exact same "rating" values from the Hebrew input, translate only the "note" values.
- For recommended_gear_en: keep the exact same "primary" boolean values, translate gear names to standard English photography terminology (e.g. "עדשה רחבה 16-35mm" becomes "Wide-angle 16-35mm").
- If a field is empty or null in Hebrew, return an empty string for its English version.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) return jsonRes({ error: 'Claude API נכשל', status: res.status }, 502, request);
  const data = await res.json();
  const text = (data.content?.[0]?.text || '').trim();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return jsonRes({ error: 'JSON לא תקין מ-Claude' }, 500, request);
    try { parsed = JSON.parse(match[0]); } catch { return jsonRes({ error: 'JSON לא תקין מ-Claude' }, 500, request); }
  }

  const when_to_visit_en = typeof parsed.when_to_visit_en === 'object' ? JSON.stringify(parsed.when_to_visit_en) : (parsed.when_to_visit_en || null);
  const recommended_gear_en = Array.isArray(parsed.recommended_gear_en) ? JSON.stringify(parsed.recommended_gear_en) : (parsed.recommended_gear_en || null);

  await env.DB.prepare(`
    UPDATE locations SET
      title_en = ?, description_en = ?, best_time_en = ?,
      equipment_en = ?, my_tip_en = ?,
      when_to_visit_en = ?, recommended_gear_en = ?
    WHERE id = ?
  `).bind(
    parsed.title_en || '',
    parsed.description_en || '',
    parsed.best_time_en || '',
    parsed.equipment_en || '',
    parsed.my_tip_en || '',
    when_to_visit_en,
    recommended_gear_en,
    slug
  ).run();

  return jsonRes({ message: 200, title_en: parsed.title_en || '' }, 200, request);
}

// ===== LOCATION PHOTOS MANAGEMENT =====

async function handleAdminLocationPhotosAdd(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);

  const loc = await env.DB.prepare('SELECT id FROM locations WHERE id = ?').bind(slug).first();
  if (!loc) return jsonRes({ error: 'מקום לא נמצא' }, 404, request);

  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file');
    const forSale = formData.get('for_sale') === '1' ? 1 : 0;
    if (!file) return jsonRes({ error: 'קובץ חסר' }, 400, request);

    const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
    const uuid = crypto.randomUUID();
    const r2Key = `locations/${slug}/${uuid}.${ext}`;
    const buf = await file.arrayBuffer();
    await env.PHOTOS.put(r2Key, buf, { httpMetadata: { contentType: file.type || 'image/jpeg' } });

    const url = `${new URL(request.url).origin}/photos/${r2Key}`;
    const { results: maxSort } = await env.DB.prepare(
      'SELECT MAX(sort_order) AS m FROM location_photos WHERE location_id = ?'
    ).bind(slug).all();
    const nextSort = (maxSort?.[0]?.m ?? -1) + 1;

    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO location_photos (id, location_id, type, r2_key, url, thumbnail, sort_order, for_sale) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(id, slug, 'exclusive', r2Key, url, url, nextSort, forSale).run();

    return jsonRes({ id, type: 'exclusive', url, thumbnail: url, sort_order: nextSort, for_sale: forSale }, 201, request);

  } else {
    const { photo_id, for_sale } = await request.json().catch(() => ({}));
    if (!photo_id) return jsonRes({ error: 'photo_id חסר' }, 400, request);

    const photo = await env.DB.prepare('SELECT url, thumbnail FROM photos WHERE id = ?').bind(photo_id).first();
    if (!photo) return jsonRes({ error: 'תמונה לא נמצאה' }, 404, request);

    const { results: maxSort } = await env.DB.prepare(
      'SELECT MAX(sort_order) AS m FROM location_photos WHERE location_id = ?'
    ).bind(slug).all();
    const nextSort = (maxSort?.[0]?.m ?? -1) + 1;

    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO location_photos (id, location_id, type, photo_id, url, thumbnail, sort_order, for_sale) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(id, slug, 'gallery', photo_id, photo.url, photo.thumbnail, nextSort, for_sale ? 1 : 0).run();

    return jsonRes({ id, type: 'gallery', photo_id, url: photo.url, thumbnail: photo.thumbnail, sort_order: nextSort, for_sale: for_sale ? 1 : 0 }, 201, request);
  }
}

async function handleAdminLocationPhotosDelete(request, env, slug, photoEntryId) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'DELETE') return jsonRes({ error: 'DELETE only' }, 405, request);

  const entry = await env.DB.prepare(
    "SELECT type, r2_key FROM location_photos WHERE id = ? AND location_id = ?"
  ).bind(photoEntryId, slug).first();
  if (!entry) return jsonRes({ error: 'לא נמצא' }, 404, request);

  if (entry.type === 'exclusive' && entry.r2_key) {
    await env.PHOTOS.delete(entry.r2_key).catch(() => {});
  }

  await env.DB.prepare('DELETE FROM location_photos WHERE id = ?').bind(photoEntryId).run();
  return jsonRes({ ok: true }, 200, request);
}

async function handleAdminLocationPhotosReorder(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);

  const { order } = await request.json().catch(() => ({}));
  if (!Array.isArray(order)) return jsonRes({ error: 'order חסר' }, 400, request);

  for (let i = 0; i < order.length; i++) {
    await env.DB.prepare(
      'UPDATE location_photos SET sort_order = ? WHERE id = ? AND location_id = ?'
    ).bind(i, order[i], slug).run();
  }
  return jsonRes({ ok: true }, 200, request);
}

async function handleAdminLocationPhotoAddToGallery(request, env, slug, photoId) {
  if (!await checkAuth(request, env)) return unauth(request);

  const { category } = await request.json().catch(() => ({}));
  if (!category) return jsonRes({ error: 'קטגוריה חסרה' }, 400, request);

  // Get the location photo record
  const locPhoto = await env.DB.prepare(
    'SELECT url, thumbnail, r2_key FROM location_photos WHERE id = ? AND location_id = ?'
  ).bind(photoId, slug).first();
  if (!locPhoto) return jsonRes({ error: 'תמונה לא נמצאה' }, 404, request);

  // Generate AI title
  const title = await generateHebrewTitle(locPhoto.url, category, env) || category;

  // Insert into photos table
  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO photos (id, title, category, description, filename, r2_key, url, thumbnail, created_at, published, is_new)
     VALUES (?,?,?,?,?,?,?,?,?,1,1)`
  ).bind(
    newId, title, category, '', '',
    locPhoto.r2_key || '',
    locPhoto.url,
    locPhoto.thumbnail || locPhoto.url,
    now
  ).run();

  // Link the new gallery photo back to the location photo entry
  await env.DB.prepare(
    'UPDATE location_photos SET photo_id = ?, for_sale = 1 WHERE id = ? AND location_id = ?'
  ).bind(newId, photoId, slug).run();

  return jsonRes({ id: newId, title, category }, 201, request);
}

// ===== PINTEREST =====
async function findOrCreateBoard(categoryName, env, token) {
  const cacheKey = `pinterest_board_${categoryName}`;
  const cached = await env.DB.prepare(`SELECT value FROM settings WHERE key=?`).bind(cacheKey).first();
  if (cached) return cached.value;

  const boardsRes = await fetch('https://api.pinterest.com/v5/boards?page_size=100', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const boardsData = await boardsRes.json();
  const boards = boardsData.items || [];

  const match = boards.find(b => b.name.toLowerCase() === categoryName.toLowerCase());
  const upsertCache = (id) => env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).bind(cacheKey, id).run();

  if (match) {
    await upsertCache(match.id);
    return match.id;
  }

  const createRes = await fetch('https://api.pinterest.com/v5/boards', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: categoryName, privacy: 'PUBLIC' }),
  });
  const board = await createRes.json();
  if (board.id) {
    await upsertCache(board.id);
    return board.id;
  }
  return null;
}

function toAbsolutePhotoUrl(url) {
  if (!url) return '';
  const s = url.trim();
  if (s.startsWith('http')) return s;
  return `https://amitphotos.com${s.startsWith('/') ? '' : '/'}${s}`;
}

async function autoPostPhotoToPinterest(photoId, photo, env) {
  try {
    const token = await getPinterestToken(env);
    if (!token || !photo.category) return;
    const photoUrl = toAbsolutePhotoUrl(photo.url);
    const link = `https://amitphotos.com/?photo=${photoId}&buy=1`;
    const [boardId, boardIdEn, titleEn] = await Promise.all([
      findOrCreateBoard(photo.category, env, token),
      findOrCreateBoardEn(photo.category, env, token),
      translateTitleEn(photo.title, photo.description, photo.category, env),
    ]);
    if (boardId) {
      const pinRes = await fetch('https://api.pinterest.com/v5/pins', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          link, title: photo.title || '',
          description: (photo.description || '') + '\n\nעמית ארז צילום | amitphotos.com',
          board_id: boardId,
          media_source: { source_type: 'image_url', url: photoUrl },
        }),
      });
      const pinData = await pinRes.json();
      if (pinData.id) await env.DB.prepare(`UPDATE photos SET pinterest_pin_id=? WHERE id=?`).bind(pinData.id, photoId).run();
    }
    if (boardIdEn) {
      await new Promise(r => setTimeout(r, 600));
      const englishCategory = HE_TO_EN_CATEGORY[photo.category] || photo.category;
      const pinResEn = await fetch('https://api.pinterest.com/v5/pins', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          link, title: titleEn || `${englishCategory} | Amit Erez`,
          description: `Fine art photography by Israeli photographer Amit Erez.\n${englishCategory}. Available as high-quality prints at amitphotos.com.\n#photography #fineartphotography #israeliphotographer #amiterezphotography`,
          board_id: boardIdEn,
          media_source: { source_type: 'image_url', url: photoUrl },
        }),
      });
      const pinDataEn = await pinResEn.json();
      if (pinDataEn.id) await env.DB.prepare(`UPDATE photos SET pinterest_pin_id_en=? WHERE id=?`).bind(pinDataEn.id, photoId).run();
    }
  } catch { /* silent */ }
}

async function handlePinterestSyncByCategory(request, env) {
  if (!await checkAuth(request, env)) return jsonRes({ error: 'unauth' }, 401, request);
  const token = await getPinterestToken(env);
  if (!token) return jsonRes({ error: 'Pinterest לא מחובר' }, 400, request);
  const perCategory = Math.min(parseInt(new URL(request.url).searchParams.get('per') || '3'), 5);

  // Select up to N unpinned photos per category
  const { results } = await env.DB.prepare(`
    SELECT * FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY category ORDER BY created_at DESC) as rn
      FROM photos
      WHERE (pinterest_pin_id IS NULL OR pinterest_pin_id='') AND published=1 AND r2_key IS NOT NULL AND r2_key != ''
    ) WHERE rn <= ?
  `).bind(perCategory).all();

  let posted = 0, failed = 0;
  const errors = [];
  for (const photo of results) {
    try {
      const boardId = await findOrCreateBoard(photo.category, env, token);
      if (!boardId) { failed++; errors.push(`no_board:${photo.category}`); continue; }
      const photoUrl = toAbsolutePhotoUrl(photo.url);
      const pinRes = await fetch('https://api.pinterest.com/v5/pins', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          link: `https://amitphotos.com/?photo=${photo.id}&buy=1`,
          title: photo.title || '',
          description: (photo.description || '') + '\n\nעמית ארז צילום | amitphotos.com',
          board_id: boardId,
          media_source: { source_type: 'image_url', url: photoUrl },
        }),
      });
      const pinData = await pinRes.json();
      if (pinData.id) {
        await env.DB.prepare(`UPDATE photos SET pinterest_pin_id=? WHERE id=?`).bind(pinData.id, photo.id).run();
        posted++;
      } else {
        failed++;
        if (errors.length < 10) errors.push(pinData.message || pinData.code || JSON.stringify(pinData).slice(0, 120));
      }
    } catch(e) { failed++; if (errors.length < 10) errors.push(e.message); }
    await new Promise(r => setTimeout(r, 600));
  }
  const remaining = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM photos WHERE (pinterest_pin_id IS NULL OR pinterest_pin_id='') AND published=1 AND r2_key IS NOT NULL AND r2_key != ''`
  ).first();
  return jsonRes({ posted, failed, errors, remaining: remaining?.cnt || 0, categories: [...new Set(results.map(p => p.category))] }, 200, request);
}

async function handlePinterestSyncAll(request, env) {
  if (!await checkAuth(request, env)) return jsonRes({ error: 'unauth' }, 401, request);
  const token = await getPinterestToken(env);
  if (!token) return jsonRes({ error: 'Pinterest לא מחובר' }, 400, request);
  const limit = Math.min(parseInt(new URL(request.url).searchParams.get('limit') || '20'), 20);
  const { results } = await env.DB.prepare(
    `SELECT * FROM photos WHERE (pinterest_pin_id IS NULL OR pinterest_pin_id='') AND published=1 AND r2_key IS NOT NULL AND r2_key != '' ORDER BY created_at DESC LIMIT ?`
  ).bind(limit).all();
  let posted = 0, failed = 0;
  const errors = [];
  for (const photo of results) {
    try {
      const boardId = await findOrCreateBoard(photo.category, env, token);
      if (!boardId) { failed++; errors.push(`no_board:${photo.category}`); continue; }
      const photoUrl = toAbsolutePhotoUrl(photo.url);
      const pinRes = await fetch('https://api.pinterest.com/v5/pins', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          link: `https://amitphotos.com/?photo=${photo.id}&buy=1`,
          title: photo.title || '',
          description: (photo.description || '') + '\n\nעמית ארז צילום | amitphotos.com',
          board_id: boardId,
          media_source: { source_type: 'image_url', url: photoUrl },
        }),
      });
      const pinData = await pinRes.json();
      if (pinData.id) {
        await env.DB.prepare(`UPDATE photos SET pinterest_pin_id=? WHERE id=?`).bind(pinData.id, photo.id).run();
        posted++;
      } else {
        failed++;
        if (errors.length < 10) errors.push(pinData.message || pinData.code || JSON.stringify(pinData).slice(0, 120));
      }
    } catch(e) { failed++; if (errors.length < 10) errors.push(e.message); }
    await new Promise(r => setTimeout(r, 600));
  }
  const remaining = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM photos WHERE (pinterest_pin_id IS NULL OR pinterest_pin_id='') AND published=1 AND r2_key IS NOT NULL AND r2_key != ''`
  ).first();
  return jsonRes({ posted, failed, errors, remaining: remaining?.cnt || 0 }, 200, request);
}

async function handlePinterestSyncEn(request, env) {
  if (!await checkAuth(request, env)) return jsonRes({ error: 'unauth' }, 401, request);
  const token = await getPinterestToken(env);
  if (!token) return jsonRes({ error: 'Pinterest לא מחובר' }, 400, request);
  const limit = Math.min(parseInt(new URL(request.url).searchParams.get('limit') || '3'), 5);
  const { results } = await env.DB.prepare(
    `SELECT * FROM photos WHERE (pinterest_pin_id_en IS NULL OR pinterest_pin_id_en='') AND published=1 AND r2_key IS NOT NULL AND r2_key != '' ORDER BY created_at DESC LIMIT ?`
  ).bind(limit).all();
  let posted = 0, failed = 0;
  const errors = [];
  for (const photo of results) {
    try {
      const [boardIdEn, titleEn] = await Promise.all([
        findOrCreateBoardEn(photo.category, env, token),
        translateTitleEn(photo.title, photo.description, photo.category, env),
      ]);
      if (!boardIdEn) { failed++; errors.push(`no_en_board:${photo.category}`); continue; }
      const photoUrl = toAbsolutePhotoUrl(photo.url);
      const englishCategory = HE_TO_EN_CATEGORY[photo.category] || photo.category;
      const pinRes = await fetch('https://api.pinterest.com/v5/pins', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          link: `https://amitphotos.com/?photo=${photo.id}&buy=1`,
          title: titleEn || `${englishCategory} | Amit Erez`,
          description: `Fine art photography by Israeli photographer Amit Erez.\n${englishCategory}. Available as high-quality prints at amitphotos.com.\n#photography #${englishCategory.replace(/ /g, '').toLowerCase()} #fineartphotography #israeliphotographer #amiterezphotography`,
          board_id: boardIdEn,
          media_source: { source_type: 'image_url', url: photoUrl },
        }),
      });
      const pinData = await pinRes.json();
      if (pinData.id) {
        await env.DB.prepare(`UPDATE photos SET pinterest_pin_id_en=? WHERE id=?`).bind(pinData.id, photo.id).run();
        posted++;
      } else {
        failed++;
        if (errors.length < 5) errors.push(pinData.message || pinData.code || JSON.stringify(pinData).slice(0, 100));
      }
    } catch(e) { failed++; if (errors.length < 5) errors.push(e.message); }
    await new Promise(r => setTimeout(r, 500));
  }
  const remaining = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM photos WHERE (pinterest_pin_id_en IS NULL OR pinterest_pin_id_en='') AND published=1 AND r2_key IS NOT NULL AND r2_key != ''`
  ).first();
  return jsonRes({ posted, failed, errors, remaining: remaining?.cnt || 0 }, 200, request);
}


async function handlePinterestUpdateLinks(request, env) {
  if (!await checkAuth(request, env)) return jsonRes({ error: 'unauth' }, 401, request);
  const token = await getPinterestToken(env);
  if (!token) return jsonRes({ error: 'Pinterest לא מחובר' }, 400, request);
  const { results } = await env.DB.prepare(
    `SELECT id, pinterest_pin_id FROM photos WHERE pinterest_pin_id IS NOT NULL AND pinterest_pin_id != '' AND published=1`
  ).all();
  let updated = 0, failed = 0;
  const errors = [];
  for (const photo of results) {
    try {
      const res = await fetch(`https://api.pinterest.com/v5/pins/${photo.pinterest_pin_id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ link: `https://amitphotos.com/?photo=${photo.id}&buy=1` }),
      });
      if (res.ok) { updated++; }
      else {
        failed++;
        if (errors.length < 5) {
          const d = await res.json().catch(() => ({}));
          errors.push(d.message || res.status);
        }
      }
    } catch(e) { failed++; if (errors.length < 5) errors.push(e.message); }
    await new Promise(r => setTimeout(r, 300));
  }
  return jsonRes({ updated, failed, errors, total: results.length }, 200, request);
}

async function storePinterestTokens(env, tokenData) {
  const { access_token, refresh_token, expires_in, refresh_token_expires_in } = tokenData;
  const expiresAt = Date.now() + (expires_in || 2592000) * 1000;
  const upsert = (k, v) => env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).bind(k, String(v)).run();
  const ops = [
    upsert('pinterest_access_token', access_token),
    upsert('pinterest_token_expires_at', expiresAt),
  ];
  if (refresh_token) ops.push(upsert('pinterest_refresh_token', refresh_token));
  await Promise.all(ops);
}

async function getPinterestToken(env) {
  const [tokenRow, expiryRow, refreshRow] = await Promise.all([
    env.DB.prepare("SELECT value FROM settings WHERE key='pinterest_access_token'").first(),
    env.DB.prepare("SELECT value FROM settings WHERE key='pinterest_token_expires_at'").first(),
    env.DB.prepare("SELECT value FROM settings WHERE key='pinterest_refresh_token'").first(),
  ]);
  if (!tokenRow) return null;
  const expiresAt = parseInt(expiryRow?.value || '0');
  if (Date.now() < expiresAt - 60000) return tokenRow.value;
  if (!refreshRow) return null;
  try {
    const credentials = btoa(`${env.PINTEREST_APP_ID}:${env.PINTEREST_APP_SECRET}`);
    const res = await fetch('https://api.pinterest.com/v5/oauth/token', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshRow.value }),
    });
    const data = await res.json();
    if (!data.access_token) return null;
    await storePinterestTokens(env, data);
    return data.access_token;
  } catch { return null; }
}

async function handlePinterestStatus(request, env) {
  if (!await checkAuth(request, env)) return jsonRes({ error: 'unauth' }, 401, request);
  const token = await getPinterestToken(env);
  if (!token) return jsonRes({ connected: false }, 200, request);
  const [usernameRow, boardsRes] = await Promise.all([
    env.DB.prepare("SELECT value FROM settings WHERE key='pinterest_username'").first(),
    fetch('https://api.pinterest.com/v5/boards?page_size=50', { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  if (!boardsRes.ok) return jsonRes({ connected: false, expired: true }, 200, request);
  const boardsData = await boardsRes.json();
  return jsonRes({ connected: true, username: usernameRow?.value || '', boards: boardsData.items || [] }, 200, request);
}

async function handlePinterestPost(request, env) {
  if (!await checkAuth(request, env)) return jsonRes({ error: 'unauth' }, 401, request);
  const { photo_id, board_id, description } = await request.json();
  if (!photo_id || !board_id) return jsonRes({ error: 'photo_id ו-board_id נדרשים' }, 400, request);
  const token = await getPinterestToken(env);
  if (!token) return jsonRes({ error: 'Pinterest לא מחובר — חבר חשבון בהגדרות' }, 400, request);
  const photo = await env.DB.prepare('SELECT * FROM photos WHERE id=?').bind(photo_id).first();
  if (!photo) return jsonRes({ error: 'תמונה לא נמצאה' }, 404, request);
  const pinRes = await fetch('https://api.pinterest.com/v5/pins', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      link: `https://amitphotos.com/?photo=${photo_id}`,
      title: photo.title || '',
      description: description || ((photo.description || '') + ' | עמית ארז צילום'),
      board_id,
      media_source: { source_type: 'image_url', url: toAbsolutePhotoUrl(photo.url) },
    }),
  });
  const pinData = await pinRes.json();
  if (!pinRes.ok) return jsonRes({ error: pinData.message || 'שגיאה ביצירת פין' }, 500, request);
  return jsonRes({ success: true, pin_id: pinData.id, pin_url: `https://www.pinterest.com/pin/${pinData.id}/` }, 200, request);
}

async function handlePinterestBoards(request, env) {
  if (!await checkAuth(request, env)) return jsonRes({ error: 'unauth' }, 401, request);
  const token = await getPinterestToken(env);
  if (!token) return jsonRes({ error: 'Pinterest לא מחובר' }, 400, request);
  const boardsRes = await fetch('https://api.pinterest.com/v5/boards?page_size=50', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const boards = await boardsRes.json();
  return jsonRes({ boards: boards.items || [] }, 200, request);
}

async function handlePinterestAuth(request, env) {
  const appId = env.PINTEREST_APP_ID;
  if (!appId) return new Response('PINTEREST_APP_ID לא מוגדר', { status: 500 });
  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/pinterest/callback`;
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'boards:read,boards:write,pins:read,pins:write,user_accounts:read',
    state: crypto.randomUUID(),
  });
  return Response.redirect(`https://www.pinterest.com/oauth/?${params}`, 302);
}

async function handlePinterestCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const origin = url.origin;
  const redirectUri = `${origin}/api/pinterest/callback`;

  if (error || !code) {
    return Response.redirect(`${origin}/admin.html?section=pinterest&pinterest_error=${encodeURIComponent(error || 'no_code')}`, 302);
  }

  try {
    const credentials = btoa(`${env.PINTEREST_APP_ID}:${env.PINTEREST_APP_SECRET}`);
    const tokenRes = await fetch('https://api.pinterest.com/v5/oauth/token', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error(tokenData.message || 'no token');

    await storePinterestTokens(env, tokenData);

    const userRes = await fetch('https://api.pinterest.com/v5/user_account', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userRes.json();
    if (userData.username) {
      await env.DB.prepare(
        `INSERT INTO settings (key, value) VALUES ('pinterest_username', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
      ).bind(userData.username).run();
    }

    return Response.redirect(`${origin}/admin.html?section=pinterest&pinterest=connected`, 302);
  } catch (e) {
    return Response.redirect(`${origin}/admin.html?section=pinterest&pinterest_error=${encodeURIComponent(e.message)}`, 302);
  }
}

// ===== NEWSLETTER SYSTEM =====

const NL_GUIDE_SLUGS = [
  'lenses','light','exposure','depth-of-field','filters',
  'composition','white-balance','histogram','dynamic-range',
  'editing','software','sports','macro','types',
  'visual-language','controls','landscape','portrait','focus'
];

const NL_GUIDE_TITLES = {
  'lenses':         { he: 'עדשות',             en: 'Lenses' },
  'light':          { he: 'אור וצבע',           en: 'Light & Color' },
  'exposure':       { he: 'חשיפה',              en: 'Exposure' },
  'depth-of-field': { he: 'עומק שדה',           en: 'Depth of Field' },
  'filters':        { he: 'פילטרים',            en: 'Filters' },
  'composition':    { he: 'קומפוזיציה',         en: 'Composition' },
  'white-balance':  { he: 'איזון לבן',          en: 'White Balance' },
  'histogram':      { he: 'היסטוגרם',           en: 'Histogram' },
  'dynamic-range':  { he: 'טווח דינמי',         en: 'Dynamic Range' },
  'editing':        { he: 'עריכה בסיסית',       en: 'Basic Editing' },
  'software':       { he: 'תוכנות עריכה',       en: 'Editing Software' },
  'sports':         { he: 'ספורט ותנועה',       en: 'Sports & Motion' },
  'macro':          { he: 'צילום מאקרו',         en: 'Macro Photography' },
  'types':          { he: 'סוגי מצלמות',        en: 'Camera Types' },
  'visual-language':{ he: 'שפה ויזואלית',       en: 'Visual Language' },
  'controls':       { he: 'כפתורי המצלמה',      en: 'Camera Controls' },
  'landscape':      { he: 'לנדסקייפ',           en: 'Landscape' },
  'portrait':       { he: 'פורטרט',             en: 'Portrait' },
  'focus':          { he: 'פוקוס',              en: 'Focus Techniques' },
};

async function nlGetSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first();
  return row?.value ?? null;
}

async function nlSetSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).bind(key, String(value)).run();
}

async function nlPickHeroPhoto(env) {
  const lastId = await nlGetSetting(env, 'nl_last_hero_id') || '';
  const row = await env.DB.prepare(
    `SELECT id, title, url, thumbnail, category FROM photos WHERE id != ? AND published=1 ORDER BY created_at DESC LIMIT 1`
  ).bind(lastId).first();
  return row || null;
}

async function nlPickGuide(env) {
  const raw = await nlGetSetting(env, 'nl_guide_index');
  const idx = parseInt(raw || '0', 10) || 0;
  const slug = NL_GUIDE_SLUGS[idx % NL_GUIDE_SLUGS.length];
  return { slug, idx, ...NL_GUIDE_TITLES[slug] };
}

async function nlPickLocation(env) {
  const raw = await nlGetSetting(env, 'nl_location_index');
  const idx = parseInt(raw || '0', 10) || 0;
  const { results } = await env.DB.prepare(
    `SELECT id, title, description, best_time, my_tip FROM locations WHERE published=1 ORDER BY id LIMIT 1 OFFSET ?`
  ).bind(idx).all();
  let loc = null;
  if (!results.length) {
    const first = await env.DB.prepare(
      `SELECT id, title, description, best_time, my_tip FROM locations WHERE published=1 ORDER BY id LIMIT 1`
    ).first();
    loc = first ? { ...first, idx: 0 } : null;
  } else {
    loc = results[0] ? { ...results[0], idx } : null;
  }
  if (!loc) return null;
  const { results: locPhotos } = await env.DB.prepare(
    'SELECT url, thumbnail FROM location_photos WHERE location_id = ? ORDER BY sort_order ASC LIMIT 4'
  ).bind(loc.id).all();
  loc.photos = (locPhotos || []).map(p => toAbsolutePhotoUrl(p.url || p.thumbnail));
  return loc;
}

async function nlPickGalleryPhotos(env, heroPhotoId, heroCategory) {
  if (heroCategory) {
    const { results: samecat } = await env.DB.prepare(
      'SELECT id, title, url FROM photos WHERE published=1 AND id != ? AND category=? ORDER BY RANDOM() LIMIT 3'
    ).bind(heroPhotoId, heroCategory).all();
    if ((samecat || []).length >= 2)
      return samecat.map(p => ({ id: p.id, title: p.title || '', url: toAbsolutePhotoUrl(p.url) }));
  }
  const { results } = await env.DB.prepare(
    'SELECT id, title, url FROM photos WHERE published=1 AND id != ? ORDER BY RANDOM() LIMIT 3'
  ).bind(heroPhotoId).all();
  return (results || []).map(p => ({ id: p.id, title: p.title || '', url: toAbsolutePhotoUrl(p.url) }));
}

async function nlPickNewPhotos(env, heroPhotoId) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { results } = await env.DB.prepare(
    'SELECT id, title, url, thumbnail, category FROM photos WHERE published=1 AND id != ? AND created_at >= ? ORDER BY created_at DESC LIMIT 6'
  ).bind(heroPhotoId, cutoff).all();
  return (results || []).map(p => ({
    id: p.id, title: p.title || '',
    url: toAbsolutePhotoUrl(p.url || p.thumbnail),
    category: p.category || ''
  }));
}

async function nlGenerateContent(env, heroPhoto, guide, location, type) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  let userPrompt;
  if (type === 'full') {
    userPrompt = `כתוב תוכן לניוזלטר צילום חודשי. החזר JSON בלבד (ללא markdown), עם השדות הבאים:

{
  "hero_text_he": "פסקה קצרה (2-3 משפטים) בעברית תקנית על התמונה",
  "hero_text_en": "same paragraph in English",
  "guide_text_he": "2 משפטים מעניינים על המדריך הזה",
  "guide_text_en": "same in English",
  "location_text_he": "2-3 משפטים על המקום — מה מיוחד בו, מתי ללכת",
  "location_text_en": "same in English",
  "tip_title_he": "כותרת קצרה לטיפ (5-7 מילים)",
  "tip_title_en": "short tip title in English",
  "tip_text_he": "טיפ צילום שלא קיים באתר — מקורי, פרקטי, 2-3 משפטים",
  "tip_text_en": "same tip in English",
  "guide_steps": [
    {"num": 1, "title_he": "שם השלב (3-5 מילים)", "title_en": "step name", "text_he": "הסבר קצר (2-3 משפטים)", "text_en": "same in English"},
    {"num": 2, "title_he": "...", "title_en": "...", "text_he": "...", "text_en": "..."},
    {"num": 3, "title_he": "...", "title_en": "...", "text_he": "...", "text_en": "..."}
  ]
}

פרטים לתוכן:
- תמונה: "${heroPhoto.title}" (קטגוריה: ${heroPhoto.category || 'טבע'})
- מדריך: "${guide.he}"
- מקום: "${location.title}" — ${location.description || ''} — הזמן הטוב: ${location.best_time || 'לא צוין'}`;
  } else {
    userPrompt = `כתוב תוכן להבזק — ניוזלטר קצר ומהיר. כתוב בגוף ראשון, כאילו עמית שולח הודעה ספונטנית לחברים. החזר JSON בלבד:

{
  "hero_text_he": "1-2 משפטים אישיים — מה אני מרגיש כלפי התמונה הזו, או מה קרה ברגע הצילום",
  "hero_text_en": "same in English",
  "tip_text_he": "טיפ אחד שימושי שאני עצמי משתמש בו — קצר, ספציפי, לא כללי",
  "tip_text_en": "same in English"
}

תמונה: "${heroPhoto.title}" (קטגוריה: ${heroPhoto.category || 'טבע'})`;
  }

  const reqBody = JSON.stringify({
    model: 'claude-opus-4-7',
    max_tokens: 3500,
    system: 'אתה כותב בשמו של עמית, צלם ישראלי. כתוב תמיד בגוף ראשון ("אני", "לי", "שלי", "צילמתי"). טון אישי וחם, כאילו עמית כותב לחברים קרובים שאוהבים צילום — לא שיווקי, לא פורמלי, אמיתי. החזר JSON תקין בלבד, ללא שום טקסט נוסף.',
    messages: [{ role: 'user', content: userPrompt }]
  });
  const reqHeaders = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };

  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 3000));
    res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: reqHeaders, body: reqBody });
    if (res.status !== 529) break;
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw = (data.content?.[0]?.text ?? '').trim();
  if (!raw) throw new Error('Claude returned empty response');
  const jsonStr = raw.startsWith('```') ? raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '') : raw;
  try { return JSON.parse(jsonStr); } catch { throw new Error(`Claude JSON parse failed: ${jsonStr.slice(0, 100)}`); }
}

async function nlGenerateDraft(env, type) {
  // Get next issue number
  const rawNum = await nlGetSetting(env, 'nl_issue_number');
  const issueNumber = parseInt(rawNum || '0', 10) + 1;

  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const slug = `${monthStr}-${type}`;

  // Skip if already exists
  const existing = await env.DB.prepare('SELECT id FROM newsletter_issues WHERE slug=?').bind(slug).first();
  if (existing) return { skipped: true, slug };

  // Pick content
  const heroPhoto = await nlPickHeroPhoto(env);
  if (!heroPhoto) throw new Error('No photos found');

  const galleryPhotos = await nlPickGalleryPhotos(env, heroPhoto.id, heroPhoto.category);
  const newPhotos = await nlPickNewPhotos(env, heroPhoto.id);
  const guide = await nlPickGuide(env);
  const location = type === 'full' ? await nlPickLocation(env) : null;

  // Generate text via Claude
  const generated = await nlGenerateContent(env, heroPhoto, guide, location, type);

  // Build content_json
  const photoUrl = toAbsolutePhotoUrl(heroPhoto.url || heroPhoto.thumbnail);
  const content = type === 'full' ? {
    hero: { photo_id: heroPhoto.id, photo_url: photoUrl,
      title_he: heroPhoto.title, category: heroPhoto.category || '',
      text_he: generated.hero_text_he, text_en: generated.hero_text_en },
    guide: { slug: guide.slug, title_he: guide.he, title_en: guide.en,
      text_he: generated.guide_text_he, text_en: generated.guide_text_en,
      steps: Array.isArray(generated.guide_steps) ? generated.guide_steps : [] },
    location: location ? { id: location.id, title_he: location.title,
      text_he: generated.location_text_he, text_en: generated.location_text_en,
      photos: location.photos || [] } : null,
    tip: { title_he: generated.tip_title_he, title_en: generated.tip_title_en,
      text_he: generated.tip_text_he, text_en: generated.tip_text_en },
    gallery_photos: galleryPhotos,
    new_photos: newPhotos,
    links: [
      { label_he: 'גלריה', label_en: 'Gallery', url: '/' },
      { label_he: 'מדריכים', label_en: 'Guides', url: '/camera/' },
      { label_he: 'מקומות', label_en: 'Locations', url: '/locations/' },
      { label_he: 'ניתוחי תמונות', label_en: 'Photo Analyses', url: '/learn/' }
    ]
  } : {
    hero: { photo_id: heroPhoto.id, photo_url: photoUrl,
      title_he: heroPhoto.title, category: heroPhoto.category || '',
      text_he: generated.hero_text_he, text_en: generated.hero_text_en },
    tip: { text_he: generated.tip_text_he, text_en: generated.tip_text_en },
    gallery_photos: galleryPhotos,
    new_photos: newPhotos
  };

  const titleHe = type === 'full'
    ? `גיליון #${issueNumber} — ${['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'][now.getMonth()]} ${now.getFullYear()}`
    : `הבזק — ${['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'][now.getMonth()]} ${now.getFullYear()}`;
  const titleEn = type === 'full'
    ? `Issue #${issueNumber} — ${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
    : `Flash — ${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO newsletter_issues (id, slug, type, issue_number, title_he, title_en, content_json, status, created_at)
     VALUES (?,?,?,?,?,?,?,'draft',?)`
  ).bind(id, slug, type, issueNumber, titleHe, titleEn, JSON.stringify(content), now.toISOString()).run();

  // Update rotation (only on full issues)
  if (type === 'full') {
    await nlSetSetting(env, 'nl_last_hero_id', heroPhoto.id);
    await nlSetSetting(env, 'nl_guide_index', String((guide.idx + 1) % NL_GUIDE_SLUGS.length));
    if (location) {
      const { results: total } = await env.DB.prepare('SELECT COUNT(*) as c FROM locations WHERE published=1').all();
      const totalLocs = total[0]?.c || 1;
      await nlSetSetting(env, 'nl_location_index', String((location.idx + 1) % totalLocs));
    }
    await nlSetSetting(env, 'nl_issue_number', String(issueNumber));
  }

  return { id, slug, issueNumber };
}

async function runNewsletterCron(env) {
  const day = new Date().getDate();
  const type = day <= 2 ? 'full' : 'flash'; // days 1-2 = full, rest = flash
  try {
    const result = await nlGenerateDraft(env, type);
    console.log('[newsletter cron]', result.skipped ? 'skipped' : `draft created: ${result.slug}`);
  } catch (e) {
    console.error('[newsletter cron] error:', e.message);
  }
}

async function handleNlList(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, slug, type, issue_number, title_he, published_at, content_json
     FROM newsletter_issues WHERE status='published' ORDER BY published_at DESC LIMIT 24`
  ).all();

  const cards = (results || []).map(issue => {
    const c = JSON.parse(issue.content_json || '{}');
    const thumb = c.hero?.photo_url || '';
    const badge = issue.type === 'full' ? 'גיליון מלא' : 'הבזק';
    const badgeEn = issue.type === 'full' ? 'Full Issue' : 'Flash';
    const date = issue.published_at ? issue.published_at.slice(0, 10) : '';
    return `<a class="nl-card" href="/newsletter/${escXml(issue.slug)}/">
      ${thumb ? `<img src="${escXml(thumb)}" alt="${escXml(issue.title_he)}" loading="lazy">` : '<div class="nl-card-placeholder"></div>'}
      <div class="nl-card-body">
        <span class="nl-badge" data-he="${escXml(badge)}" data-en="${escXml(badgeEn)}">${escXml(badge)}</span>
        <div class="nl-card-title">${escXml(issue.title_he)}</div>
        <div class="nl-card-date">${escXml(date)}</div>
      </div>
    </a>`;
  }).join('\n');

  const empty = !results?.length
    ? '<p style="text-align:center;color:#888;padding:4rem">הניוזלטר הראשון יפורסם בקרוב</p>'
    : '';

  return new Response(`<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ניוזלטר | Amit Photos</title>
<link rel="canonical" href="https://amitphotos.com/newsletter/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&family=Syne:wght@700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a0a;--surface:#111;--border:#222;--accent:#c8a96e;--text:#f0ede8;--muted:#888}
body{font-family:'Heebo',sans-serif;background:var(--bg);color:var(--text);direction:rtl;min-height:100vh;padding:0 0 4rem}
.page-hero{text-align:center;padding:2.5rem 1.25rem 1.5rem}
.page-hero h1{font-family:'Syne',sans-serif;font-size:1.8rem;color:var(--accent);margin-bottom:.5rem}
.page-hero p{color:var(--muted);font-size:.9rem}
.nl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1.25rem;padding:1.25rem;max-width:1100px;margin:0 auto}
.nl-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;text-decoration:none;color:inherit;transition:border-color .2s}
.nl-card:hover{border-color:var(--accent)}
.nl-card img,.nl-card-placeholder{width:100%;height:160px;object-fit:cover;display:block;background:#1a1a1a}
.nl-card-body{padding:.75rem 1rem}
.nl-badge{display:inline-block;font-size:.68rem;background:rgba(200,169,110,.12);border:1px solid rgba(200,169,110,.3);color:var(--accent);border-radius:20px;padding:2px 8px;margin-bottom:.5rem}
.nl-card-title{font-family:'Syne',sans-serif;font-size:.95rem;color:var(--text);margin-bottom:.3rem}
.nl-card-date{font-size:.75rem;color:var(--muted)}
</style>
<script src="/assets/js/nav.js" defer></script>
</head>
<body>
<div class="page-hero">
  <h1 data-he="ניוזלטר" data-en="Newsletter">ניוזלטר</h1>
  <p data-he="גיליונות חודשיים — תמונות, מדריכים ומקומות צילום" data-en="Monthly issues — photos, guides and shooting locations">גיליונות חודשיים — תמונות, מדריכים ומקומות צילום</p>
</div>
<div class="nl-grid">${cards}${empty}</div>
<script>
function getLang(){return localStorage.getItem('lang')||'he'}
function applyLang(){const lang=getLang(),isEn=lang==='en';document.documentElement.dir=isEn?'ltr':'rtl';document.documentElement.lang=lang;document.querySelectorAll('[data-he]').forEach(el=>{el.innerHTML=isEn?(el.dataset.en||el.dataset.he):el.dataset.he})}
applyLang();window.setLang=applyLang;window.addEventListener('storage',e=>{if(e.key==='lang')applyLang()})
</script>
</body></html>`, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-cache' } });
}

async function handleNlIssue(env, slug, isPreview) {
  const issue = await env.DB.prepare(
    `SELECT * FROM newsletter_issues WHERE slug=?${isPreview ? '' : " AND status='published'"}`
  ).bind(slug).first();
  if (!issue) return new Response('Not found', { status: 404 });

  const c = JSON.parse(issue.content_json || '{}');
  const isFull = issue.type === 'full';
  const dateStr = issue.published_at ? issue.published_at.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const pageUrl = `https://amitphotos.com/newsletter/${slug}/`;
  const waHref = escXml(`https://wa.me/?text=${encodeURIComponent(issue.title_he + ' — ' + pageUrl)}`);

  const heroPriceHtml = c.sale?.sale_price ? `
      <div class="nl-hero-price">
        <span class="nl-hero-price-orig">${escXml(c.sale.original_price || '')}</span>
        <span class="nl-hero-price-sale">${escXml(c.sale.sale_price)}</span>
      </div>` : '';
  const heroSection = c.hero ? `
    <section class="nl-section nl-hero-section">
      <img src="${escXml(c.hero.photo_url)}" alt="${escXml(c.hero.title_he)}" class="nl-hero-img">
      <h2 class="nl-photo-title" data-he="${escXml(c.hero.title_he)}" data-en="${escXml(c.hero.title_he)}">${escXml(c.hero.title_he)}</h2>
      <p class="nl-body-text" data-he="${escXml(c.hero.text_he)}" data-en="${escXml(c.hero.text_en || c.hero.text_he)}">${escXml(c.hero.text_he)}</p>
      <div class="nl-hero-footer">${heroPriceHtml}<a class="nl-btn-secondary nl-hero-order" href="/?photo=${escXml(c.hero.photo_id)}" data-he="רכוש קובץ ←" data-en="Buy File →">רכוש קובץ ←</a></div>
    </section>` : '';

  const guideSection = isFull && c.guide ? (() => {
    const hasSteps = Array.isArray(c.guide.steps) && c.guide.steps.length > 0;
    if (hasSteps) {
      const pillsHtml = c.guide.steps.map((s, i) =>
        `<button class="nl-step-pill${i === 0 ? ' nl-step-active' : ''}" onclick="showStep(${i + 1})">
          <span class="nl-step-num">${String(i + 1).padStart(2, '0')}</span>
          <span class="nl-step-label" data-he="${escXml(s.title_he)}" data-en="${escXml(s.title_en || s.title_he)}">${escXml(s.title_he)}</span>
        </button>`
      ).join('');
      const heroThumb = c.hero?.photo_url || '';
      const _stepOverlays = [
        `<svg class="nl-vis-svg" viewBox="0 0 300 200" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="100" y1="0" x2="100" y2="200" stroke="rgba(200,169,110,.55)" stroke-width="1.5"/><line x1="200" y1="0" x2="200" y2="200" stroke="rgba(200,169,110,.55)" stroke-width="1.5"/><line x1="0" y1="67" x2="300" y2="67" stroke="rgba(200,169,110,.55)" stroke-width="1.5"/><line x1="0" y1="133" x2="300" y2="133" stroke="rgba(200,169,110,.55)" stroke-width="1.5"/><circle cx="100" cy="67" r="5" fill="rgba(200,169,110,.85)"/><circle cx="200" cy="67" r="5" fill="rgba(200,169,110,.85)"/><circle cx="100" cy="133" r="5" fill="rgba(200,169,110,.85)"/><circle cx="200" cy="133" r="5" fill="rgba(200,169,110,.85)"/></svg>`,
        `<svg class="nl-vis-svg" viewBox="0 0 300 200" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><marker id="nl-arr" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto"><polygon points="0,0 7,3.5 0,7" fill="rgba(200,169,110,.85)"/></marker></defs><line x1="15" y1="195" x2="190" y2="78" stroke="rgba(200,169,110,.7)" stroke-width="1.5" marker-end="url(#nl-arr)"/><line x1="70" y1="200" x2="190" y2="78" stroke="rgba(200,169,110,.5)" stroke-width="1.5" marker-end="url(#nl-arr)"/><line x1="0" y1="150" x2="190" y2="78" stroke="rgba(200,169,110,.35)" stroke-width="1.5" marker-end="url(#nl-arr)"/><circle cx="190" cy="78" r="7" stroke="rgba(200,169,110,.9)" stroke-width="1.5"/></svg>`,
        `<svg class="nl-vis-svg" viewBox="0 0 300 200" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="48" height="200" fill="rgba(0,0,0,.32)"/><rect x="252" y="0" width="48" height="200" fill="rgba(0,0,0,.32)"/><rect x="0" y="0" width="300" height="36" fill="rgba(0,0,0,.32)"/><rect x="0" y="164" width="300" height="36" fill="rgba(0,0,0,.32)"/><path d="M20,20 L20,48 M20,20 L48,20" stroke="rgba(200,169,110,.9)" stroke-width="2.5" stroke-linecap="round"/><path d="M280,20 L280,48 M280,20 L252,20" stroke="rgba(200,169,110,.9)" stroke-width="2.5" stroke-linecap="round"/><path d="M20,180 L20,152 M20,180 L48,180" stroke="rgba(200,169,110,.9)" stroke-width="2.5" stroke-linecap="round"/><path d="M280,180 L280,152 M280,180 L252,180" stroke="rgba(200,169,110,.9)" stroke-width="2.5" stroke-linecap="round"/></svg>`
      ];
      const stepsHtml = c.guide.steps.map((s, i) =>
        `<div class="nl-step-content" id="step-${i + 1}"${i > 0 ? ' style="display:none"' : ''}>
          <div class="nl-step-body">
            <div class="nl-step-info">
              <div class="nl-step-num-bg">${String(i + 1).padStart(2, '0')}</div>
              <h3 class="nl-step-title" data-he="${escXml(s.title_he)}" data-en="${escXml(s.title_en || s.title_he)}">${escXml(s.title_he)}</h3>
              <p class="nl-body-text" data-he="${escXml(s.text_he)}" data-en="${escXml(s.text_en || s.text_he)}">${escXml(s.text_he)}</p>
            </div>
            ${heroThumb ? `<div class="nl-step-vis"><div class="nl-vis-wrap"><img src="${escXml(heroThumb)}" class="nl-vis-img" loading="lazy" alt="">${_stepOverlays[i] || _stepOverlays[0]}</div></div>` : ''}
          </div>
        </div>`
      ).join('');
      const guideCtaBanner = `
      <a class="nl-guide-cta-banner" href="/camera/${escXml(c.guide.slug)}/">
        <div class="nl-guide-cta-text">
          <div class="nl-guide-cta-label" data-he="המדריך המלא באתר" data-en="Full Guide on Site">המדריך המלא באתר</div>
          <div class="nl-guide-cta-title" data-he="${escXml(c.guide.title_he)}" data-en="${escXml(c.guide.title_en || c.guide.title_he)}">${escXml(c.guide.title_he)}</div>
        </div>
        <span class="nl-guide-cta-arrow" data-he="←" data-en="→">←</span>
      </a>`;
      return `
    <section class="nl-section nl-guide-section">
      <div class="nl-section-badge" data-he="מדריך החודש" data-en="Guide of the Month">מדריך החודש</div>
      <h2 class="nl-section-title" data-he="${escXml(c.guide.title_he)}" data-en="${escXml(c.guide.title_en || c.guide.title_he)}">${escXml(c.guide.title_he)}</h2>
      <div class="nl-steps-nav">${pillsHtml}</div>
      ${stepsHtml}
      ${guideCtaBanner}
    </section>`;
    } else {
      return `
    <section class="nl-section nl-guide-section">
      <div class="nl-section-badge" data-he="מדריך החודש" data-en="Guide of the Month">מדריך החודש</div>
      <h2 class="nl-section-title" data-he="${escXml(c.guide.title_he)}" data-en="${escXml(c.guide.title_en || c.guide.title_he)}">${escXml(c.guide.title_he)}</h2>
      <p class="nl-body-text" data-he="${escXml(c.guide.text_he)}" data-en="${escXml(c.guide.text_en || c.guide.text_he)}">${escXml(c.guide.text_he)}</p>
      <a class="nl-guide-cta-banner" href="/camera/${escXml(c.guide.slug)}/">
        <div class="nl-guide-cta-text">
          <div class="nl-guide-cta-label">המדריך המלא באתר</div>
          <div class="nl-guide-cta-title">${escXml(c.guide.title_he)}</div>
        </div>
        <span class="nl-guide-cta-arrow">←</span>
      </a>
    </section>`;
    }
  })() : '';

  const locationSection = isFull && c.location ? (() => {
    const lPhotos = Array.isArray(c.location.photos) ? c.location.photos.filter(Boolean) : [];
    const mainPhoto = lPhotos[0] || '';
    const stripPhotos = lPhotos.slice(1, 4);
    return `
    <section class="nl-section nl-location-section">
      <div class="nl-section-badge" data-he="מקום לצילום" data-en="Photo Location">מקום לצילום</div>
      <h2 class="nl-section-title" data-he="${escXml(c.location.title_he)}" data-en="${escXml(c.location.title_he)}">${escXml(c.location.title_he)}</h2>
      ${mainPhoto ? `<div class="nl-loc-photos">
        <img src="${escXml(mainPhoto)}" alt="${escXml(c.location.title_he)}" class="nl-loc-main-img" loading="lazy">
        ${stripPhotos.length ? `<div class="nl-loc-strip">${stripPhotos.map(u =>
          `<img src="${escXml(u)}" alt="" class="nl-loc-strip-img" loading="lazy">`
        ).join('')}</div>` : ''}
      </div>` : ''}
      <p class="nl-body-text" data-he="${escXml(c.location.text_he)}" data-en="${escXml(c.location.text_en || c.location.text_he)}">${escXml(c.location.text_he)}</p>
      <div class="nl-location-links">
        <a class="nl-location-btn" href="/locations/">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          <span data-he="לכל המקומות" data-en="All Locations">לכל המקומות</span>
        </a>
        <a class="nl-location-btn" href="https://www.google.com/maps/search/${encodeURIComponent(c.location.title_he)}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
          <span data-he="פתח במפה" data-en="Open in Maps">פתח במפה</span>
        </a>
      </div>
    </section>`;
  })() : '';

  const tipSection = c.tip ? `
    <section class="nl-section nl-tip-section">
      <div class="nl-tip-card">
        <div class="nl-tip-header">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="nl-tip-icon"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>
          <div class="nl-tip-title" data-he="${escXml(c.tip.title_he || 'טיפ החודש')}" data-en="${escXml(c.tip.title_en || 'Tip of the Month')}">${escXml(c.tip.title_he || 'טיפ החודש')}</div>
        </div>
        <div class="nl-tip-grid">
          <div>
            <p class="nl-tip-text" data-he="${escXml(c.tip.text_he)}" data-en="${escXml(c.tip.text_en || c.tip.text_he)}">${escXml(c.tip.text_he)}</p>
            <a class="nl-link nl-tip-more" href="/camera/" data-he="לטיפים נוספים ומדריכים ←" data-en="More Tips & Guides →">לטיפים נוספים ומדריכים ←</a>
          </div>
          ${c.hero?.photo_url ? `<a class="nl-tip-img-wrap" href="/?photo=${escXml(c.hero.photo_id)}">
            <img src="${escXml(c.hero.photo_url)}" alt="${escXml(c.hero.title_he)}" class="nl-tip-img" loading="lazy">
          </a>` : ''}
        </div>
      </div>
    </section>` : '';

  const linksSection = isFull && c.links ? `
    <section class="nl-section nl-links-section">
      <div class="nl-section-badge" data-he="קישורים שימושיים" data-en="Useful Links">קישורים שימושיים</div>
      <div class="nl-links-row">${c.links.map(l =>
        `<a class="nl-link-pill" href="${escXml(l.url)}" data-he="${escXml(l.label_he)}" data-en="${escXml(l.label_en)}">${escXml(l.label_he)}</a>`
      ).join('')}</div>
    </section>` : '';

  const newPhotosSection = (c.new_photos && c.new_photos.length) ? `
    <section class="nl-section nl-new-photos-section">
      <div class="nl-section-badge" data-he="חדש בגלריה" data-en="New in Gallery">חדש בגלריה</div>
      <div class="nl-new-photos-grid">
        ${c.new_photos.map(p => `
          <a class="nl-new-photo-card" href="/?photo=${escXml(p.id)}">
            <div class="nl-new-photo-img-wrap">
              <img src="${escXml(p.url)}" alt="${escXml(p.title)}" loading="lazy">
              <span class="nl-new-badge" data-he="חדש" data-en="New">חדש</span>
            </div>
            <span class="nl-new-photo-title">${escXml(p.title)}</span>
          </a>`).join('')}
      </div>
      <a class="nl-new-gallery-link" href="/" data-he="לכל הגלריה ←" data-en="Full Gallery →">לכל הגלריה ←</a>
    </section>` : '';

  const galleryBadgeHe = c.hero?.category ? `עוד ${escXml(c.hero.category)}` : 'עוד מהגלריה';
  const galleryBadgeEn = c.hero?.category ? `More ${escXml(c.hero.category)}` : 'More from Gallery';
  const galleryStripSection = (c.gallery_photos && c.gallery_photos.length) ? `
    <section class="nl-section nl-gallery-section">
      <div class="nl-section-badge" data-he="${galleryBadgeHe}" data-en="${galleryBadgeEn}">${galleryBadgeHe}</div>
      <div class="nl-gallery-strip">
        ${c.gallery_photos.slice(0, 3).map(photo =>
          `<a class="nl-gallery-thumb" href="/?photo=${escXml(photo.id)}">
            <img src="${escXml(photo.url)}" alt="${escXml(photo.title)}" loading="lazy">
            <span>${escXml(photo.title)}</span>
          </a>`
        ).join('')}
        <a class="nl-gallery-more" href="/" data-he="לכל הגלריה ←" data-en="Full Gallery →">לכל הגלריה ←</a>
      </div>
    </section>` : '';

  const saleBannerSection = isFull && c.sale?.title_he ? `
    <section class="nl-section nl-sale-section">
      <div class="nl-sale-banner">
        <div class="nl-sale-header">
          <span class="nl-sale-tag">${escXml(c.sale.discount_label)}</span>
          <span class="nl-sale-title">${escXml(c.sale.title_he)}</span>
        </div>
        <p class="nl-sale-desc">${escXml(c.sale.desc_he)}</p>
        <div class="nl-sale-pricing">
          <span class="nl-sale-original">${escXml(c.sale.original_price)}</span>
          <span class="nl-sale-price">${escXml(c.sale.sale_price)}</span>
        </div>
        <a class="nl-btn-primary" href="/">לכל המבצעים ←</a>
      </div>
    </section>` : '';

  const _svgWa = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-left:4px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const _svgPhone = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-left:4px"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.42 2 2 0 0 1 3.6 1.24h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6 6l.87-.87a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
  const _svgPerson = `<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  const _icoHome = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
  const _icoBrief = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`;
  const _icoGift = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect width="20" height="5" x="2" y="7"/><line x1="12" x2="12" y1="22" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`;
  const _icoPrint = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>`;
  const _icoCamera = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/></svg>`;
  const _icoUser = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  const _icoImage = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  const _heroPhotoHref = c.hero?.photo_id ? `/?photo=${escXml(c.hero.photo_id)}` : '/';
  const _heroCat = c.hero?.category || '';
  const _ctaByCategory = {
    'פורטרט': [
      { ico: _icoUser,   label: 'רכוש קובץ פורטרט',      href: _heroPhotoHref },
      { ico: _icoGift,   label: 'מתנה מרגשת',            href: '/contact/' },
      { ico: _icoCamera, label: 'סשן צילום אישי',         href: '/contact/' },
      { ico: _icoImage,  label: 'כל הגלריה',              href: '/' }
    ],
    'עירוני': [
      { ico: _icoHome,   label: 'קובץ לסלון / משרד',     href: _heroPhotoHref },
      { ico: _icoBrief,  label: 'עיצוב ואדריכלות',        href: '/?category=%D7%A2%D7%99%D7%A8%D7%95%D7%A0%D7%99' },
      { ico: _icoGift,   label: 'מתנה ייחודית',            href: '/contact/' },
      { ico: _icoImage,  label: 'כל הגלריה',              href: '/' }
    ],
    'אירועים': [
      { ico: _icoCamera, label: 'צלם לאירוע שלך',         href: '/contact/' },
      { ico: _icoBrief,  label: 'חתונה / כנס / תאגיד',   href: '/contact/' },
      { ico: _icoGift,   label: 'מתנה עסקית',             href: '/contact/' },
      { ico: _icoHome,   label: 'קובץ לסלון',             href: _heroPhotoHref }
    ]
  };
  const contactOutreachSection = `
    <section class="nl-section nl-contact-section">
      <div class="nl-contact-card">
        <h2 class="nl-contact-heading" data-he="מחפש תמונה לבית ולמשרד?" data-en="Looking for a photo for home or office?">מחפש תמונה לבית ולמשרד?</h2>
        <div class="nl-contact-header">
          <span class="nl-contact-avatar">${_svgPerson}</span>
          <div class="nl-contact-name" data-he="עמית — צלם אישי" data-en="Amit — Personal Photographer">עמית — צלם אישי</div>
        </div>
        <div class="nl-contact-btns">
          <a class="nl-contact-btn nl-contact-wa" href="https://wa.me/972503333227" target="_blank" rel="noopener">${_svgWa} <span data-he="וואטסאפ" data-en="WhatsApp">וואטסאפ</span></a>
          <a class="nl-contact-btn" href="tel:+972503333227">${_svgPhone} 050-3333227</a>
        </div>
        <p class="nl-contact-quote" data-he="רוצה לבחור תמונה לבית? לקנות קובץ, או סתם לשאול? אני כאן." data-en="Want to choose a photo for your home? Buy a file, or just ask? I'm here.">רוצה לבחור תמונה לבית? לקנות קובץ, או סתם לשאול? אני כאן.</p>
        <p class="nl-contact-note" data-he="ניתן לשלם: ביט · פייבוקס · פייפל" data-en="Payment: Bit · Paybox · PayPal">ניתן לשלם: ביט · פייבוקס · פייפל</p>
      </div>
    </section>`;

  const previewBanner = isPreview
    ? `<div style="background:#7c3f00;color:#fff;text-align:center;padding:.5rem;font-size:.8rem">טיוטה — לא פורסמה</div>` : '';

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escXml(issue.title_he)} | Amit Photos</title>
${!isPreview ? `<link rel="canonical" href="https://amitphotos.com/newsletter/${escXml(slug)}/">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&family=Syne:wght@700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a0a;--surface:#111;--border:#222;--accent:#c8a96e;--text:#f0ede8;--muted:#888}
body{font-family:'Heebo',sans-serif;background:var(--bg);color:var(--text);direction:rtl;min-height:100vh}
.nl-header{display:flex;justify-content:space-between;align-items:center;padding:1rem 1.5rem;border-bottom:1px solid var(--border);max-width:800px;margin:0 auto}
.nl-header-logo{font-family:'Syne',sans-serif;color:var(--accent);text-decoration:none;font-size:1rem}
.nl-header-meta{font-size:.75rem;color:var(--muted)}
.nl-issue-title{font-family:'Syne',sans-serif;font-size:1.6rem;color:var(--accent);text-align:center;padding:2rem 1.5rem 1rem;max-width:800px;margin:0 auto}
.nl-section{max-width:800px;margin:0 auto;padding:1.5rem}
.nl-hero-img{width:100%;max-height:480px;object-fit:cover;border-radius:12px;display:block;margin-bottom:1rem}
.nl-photo-title{font-family:'Syne',sans-serif;font-size:1.1rem;color:var(--accent);margin-bottom:.5rem}
.nl-body-text{color:var(--text);font-size:.95rem;line-height:1.7;margin-bottom:.75rem}
.nl-section-badge{display:inline-block;font-size:.68rem;background:rgba(200,169,110,.12);border:1px solid rgba(200,169,110,.3);color:var(--accent);border-radius:20px;padding:3px 10px;margin-bottom:.75rem}
.nl-section-title{font-family:'Syne',sans-serif;font-size:1.1rem;color:var(--text);margin-bottom:.6rem}
.nl-link{color:var(--accent);font-size:.85rem;text-decoration:none;display:inline-block;margin-top:.25rem}
.nl-link:hover{text-decoration:underline}
.nl-tip-card{background:rgba(200,169,110,.08);border:1px solid rgba(200,169,110,.25);border-radius:12px;padding:1.25rem}
.nl-tip-title{font-family:'Syne',sans-serif;font-size:.95rem;color:var(--accent);margin-bottom:.5rem}
.nl-links-row{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.5rem}
.nl-link-pill{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:.4rem .9rem;font-size:.8rem;color:var(--text);text-decoration:none;transition:border-color .2s}
.nl-link-pill:hover{border-color:var(--accent);color:var(--accent)}
.nl-divider{max-width:800px;margin:0 auto;border:none;border-top:1px solid var(--border)}
.nl-wall-section{background:var(--surface);border-radius:16px;overflow:hidden;margin:1rem auto;max-width:800px;padding:1.25rem 1.5rem}
.nl-wall-room{background:#1a1209;border-radius:12px;padding:1.5rem 2rem .5rem;margin:.75rem 0;position:relative;display:flex;flex-direction:column;align-items:center}
.nl-wall-frame{border:8px solid #5a3e1b;border-radius:4px;box-shadow:0 8px 32px #0009,inset 0 2px 4px #fff1;width:min(340px,90%);aspect-ratio:4/3;overflow:hidden}
.nl-wall-photo{width:100%;height:100%;object-fit:cover;display:block}
.nl-wall-floor{width:calc(100% + 4rem);height:18px;background:linear-gradient(#8b6914,#5a3e1b);margin:0 -2rem -.5rem;opacity:.7}
.nl-wall-cta{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;margin:.75rem 0 .25rem}
.nl-wall-price{font-size:1.1rem;font-weight:700;color:var(--accent)}
.nl-btn-primary{background:var(--accent);color:#000;text-decoration:none;border-radius:20px;padding:.4rem 1.1rem;font-size:.85rem;font-weight:700}
.nl-btn-secondary{background:transparent;color:var(--accent);border:1px solid var(--accent);text-decoration:none;border-radius:20px;padding:.4rem 1.1rem;font-size:.85rem}
.nl-hero-order{display:inline-block;margin-top:.25rem}
.nl-hero-footer{display:flex;align-items:center;gap:1rem;margin-top:.5rem;flex-wrap:wrap}
.nl-hero-price{display:flex;align-items:center;gap:.5rem}
.nl-hero-price-orig{font-size:.9rem;color:var(--muted);text-decoration:line-through}
.nl-hero-price-sale{font-size:1.1rem;font-weight:700;color:var(--accent)}
.nl-tip-header{display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem}
.nl-tip-icon{color:var(--accent);flex-shrink:0}
.nl-tip-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;align-items:center}
.nl-tip-text{font-size:.85rem;color:var(--text);line-height:1.7}
.nl-tip-img-wrap{display:block;border-radius:8px;overflow:hidden;border:1px solid var(--border);text-decoration:none}
.nl-tip-img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}
@media(max-width:520px){.nl-tip-grid{grid-template-columns:1fr}.nl-tip-img-wrap{order:-1}}
.nl-loc-photos{margin:.75rem 0}
.nl-loc-main-img{width:100%;max-height:320px;object-fit:cover;border-radius:10px;display:block}
.nl-loc-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:.4rem;margin-top:.4rem}
.nl-loc-strip-img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;display:block}
.nl-location-links{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-top:.75rem}
.nl-location-btn{display:inline-flex;align-items:center;gap:.35rem;background:var(--surface);border:1px solid var(--border);color:var(--text);text-decoration:none;border-radius:20px;padding:.4rem .9rem;font-size:.8rem;transition:border-color .2s}
.nl-location-btn:hover{border-color:var(--accent);color:var(--accent)}
.nl-tip-more{display:inline-block;margin-top:.6rem;font-size:.8rem}
.nl-guide-cta-banner{display:flex;align-items:center;justify-content:space-between;background:rgba(200,169,110,.1);border:1px solid rgba(200,169,110,.35);border-radius:12px;padding:1rem 1.25rem;margin-top:1rem;text-decoration:none;transition:background .2s,border-color .2s}
.nl-guide-cta-banner:hover{background:rgba(200,169,110,.18);border-color:var(--accent)}
.nl-guide-cta-label{font-size:.72rem;color:var(--accent);letter-spacing:.04em;margin-bottom:.2rem;text-transform:uppercase}
.nl-guide-cta-title{font-family:'Syne',sans-serif;font-size:.95rem;color:var(--text)}
.nl-guide-cta-arrow{font-size:1.3rem;color:var(--accent);flex-shrink:0;margin-right:.5rem}
.nl-contact-heading{font-family:'Syne',sans-serif;font-size:1rem;color:var(--accent);margin-bottom:.75rem}
.nl-contact-quote{font-size:.92rem;color:var(--text);line-height:1.65;margin-top:.75rem}
.nl-contact-note{font-size:.85rem;color:var(--muted);margin-top:.35rem}
.nl-unsub-link{background:none;border:none;color:var(--muted);font-size:.78rem;cursor:pointer;text-decoration:underline;padding:0;font-family:inherit}
.nl-wall-materials{font-size:.75rem;color:var(--muted)}
.nl-print-section{background:var(--surface);border-radius:16px;margin:1rem auto;max-width:800px;padding:1.5rem;display:flex;flex-direction:column;align-items:center;gap:1rem}
.nl-print-frame{display:block;text-decoration:none;width:min(380px,90%)}
.nl-print-mat{background:#f8f6f1;padding:14px 14px 28px;border-radius:2px;box-shadow:0 4px 24px #0008,0 1px 3px #0004}
.nl-print-photo{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}
.nl-new-photos-section{max-width:800px;margin:0 auto;padding:1rem 1.5rem}
.nl-new-photos-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin:.75rem 0}
@media(max-width:520px){.nl-new-photos-grid{grid-template-columns:repeat(2,1fr)}}
.nl-new-photo-card{display:block;text-decoration:none;color:var(--text)}
.nl-new-photo-img-wrap{position:relative;border-radius:10px;overflow:hidden;aspect-ratio:4/3;background:#111;margin-bottom:.35rem}
.nl-new-photo-img-wrap img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .3s}
.nl-new-photo-card:hover img{transform:scale(1.04)}
.nl-new-badge{position:absolute;top:.45rem;right:.45rem;background:var(--accent);color:#000;font-size:.6rem;font-weight:700;padding:.12rem .38rem;border-radius:4px;letter-spacing:.05em}
.nl-new-photo-title{font-size:.75rem;color:var(--muted);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nl-new-gallery-link{display:inline-block;margin-top:.5rem;font-size:.82rem;color:var(--accent);text-decoration:none}
.nl-new-gallery-link:hover{text-decoration:underline}
.nl-gallery-section{max-width:800px;margin:0 auto;padding:1rem 1.5rem}
.nl-gallery-strip{display:flex;gap:.75rem;overflow-x:auto;padding-bottom:.5rem;scrollbar-width:thin;scrollbar-color:var(--border) transparent}
.nl-gallery-thumb{flex:0 0 auto;width:120px;text-decoration:none;color:var(--text)}
.nl-gallery-thumb img{width:120px;height:80px;object-fit:cover;border-radius:8px;display:block;border:1px solid var(--border)}
.nl-gallery-thumb span{display:block;font-size:.7rem;color:var(--muted);margin-top:.25rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px}
.nl-gallery-more{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:72px;height:80px;background:rgba(200,169,110,.08);border:1px solid rgba(200,169,110,.25);border-radius:8px;color:var(--accent);font-size:.72rem;text-decoration:none;text-align:center;padding:.25rem}
.nl-sale-section{max-width:800px;margin:0 auto;padding:1rem 1.5rem}
.nl-sale-banner{background:linear-gradient(135deg,rgba(200,169,110,.12),rgba(200,169,110,.05));border:1px solid rgba(200,169,110,.35);border-radius:14px;padding:1.25rem 1.5rem}
.nl-sale-header{display:flex;align-items:center;gap:.75rem;margin-bottom:.5rem;flex-wrap:wrap}
.nl-sale-tag{background:var(--accent);color:#000;font-size:.72rem;font-weight:700;border-radius:12px;padding:2px 10px}
.nl-sale-title{font-family:'Syne',sans-serif;font-size:1rem;color:var(--text)}
.nl-sale-desc{font-size:.85rem;color:var(--muted);margin-bottom:.75rem}
.nl-sale-pricing{display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem}
.nl-sale-original{font-size:.9rem;color:var(--muted);text-decoration:line-through}
.nl-sale-price{font-size:1.2rem;font-weight:700;color:var(--accent)}
.nl-steps-nav{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin:.75rem 0}
.nl-step-pill{background:var(--surface);border:1px solid var(--border);color:var(--muted);border-radius:10px;padding:.6rem .5rem;font-size:.75rem;cursor:pointer;font-family:inherit;transition:all .2s;display:flex;flex-direction:column;align-items:center;gap:.2rem;text-align:center;line-height:1.35}
.nl-step-num{font-family:'Syne',sans-serif;font-size:1.1rem;color:var(--border);transition:color .2s}
.nl-step-label{font-size:.72rem}
.nl-step-pill.nl-step-active{background:rgba(200,169,110,.1);border-color:var(--accent);color:var(--text)}
.nl-step-pill.nl-step-active .nl-step-num{color:var(--accent)}
.nl-step-title{font-family:'Syne',sans-serif;font-size:.95rem;color:var(--accent);margin-bottom:.4rem}
.nl-step-body{display:grid;grid-template-columns:1fr 132px;gap:1rem;align-items:start;margin-top:.25rem}
.nl-step-info{position:relative}
.nl-step-num-bg{font-family:'Syne',sans-serif;font-size:3.2rem;font-weight:700;color:rgba(200,169,110,.11);line-height:1;margin-bottom:-.6rem;letter-spacing:-.02em}
.nl-step-vis{width:132px;flex-shrink:0}
.nl-vis-wrap{position:relative;border-radius:8px;overflow:hidden;aspect-ratio:3/2;background:#111}
.nl-vis-img{width:100%;height:100%;object-fit:cover;display:block}
.nl-vis-svg{position:absolute;inset:0;width:100%;height:100%}
@media(max-width:480px){.nl-step-body{grid-template-columns:1fr}.nl-step-vis{display:none}}
.nl-cta-section{max-width:800px;margin:0 auto;padding:1rem 1.5rem}
.nl-cta-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-top:.75rem}
.nl-cta-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1rem;display:flex;flex-direction:column;align-items:center;text-decoration:none;gap:.4rem;transition:border-color .2s}
.nl-cta-card:hover{border-color:var(--accent)}
.nl-cta-icon{display:flex;align-items:center;justify-content:center;color:var(--accent)}
.nl-cta-label{font-size:.82rem;color:var(--text);text-align:center}
.nl-contact-section{max-width:800px;margin:0 auto;padding:1rem 1.5rem}
.nl-contact-card{background:var(--surface);border:1px solid rgba(200,169,110,.3);border-radius:14px;padding:1.25rem 1.5rem}
.nl-contact-header{display:flex;gap:1rem;align-items:flex-start;margin-bottom:1rem}
.nl-contact-avatar{display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:50%;background:rgba(200,169,110,.12);border:1px solid rgba(200,169,110,.3);flex-shrink:0;color:var(--accent)}
.nl-contact-name{font-family:'Syne',sans-serif;font-size:.95rem;color:var(--accent);margin-bottom:.25rem}
.nl-contact-intro{font-size:.85rem;color:var(--muted)}
.nl-contact-btns{display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:.75rem}
.nl-contact-btn{background:var(--surface);border:1px solid var(--border);color:var(--text);text-decoration:none;border-radius:20px;padding:.4rem 1rem;font-size:.82rem;transition:border-color .2s,color .2s}
.nl-contact-btn:hover,.nl-contact-wa{border-color:#25d366;color:#25d366}
.nl-contact-btn:hover:not(.nl-contact-wa){border-color:var(--accent);color:var(--accent)}
.nl-contact-note{font-size:.72rem;color:var(--muted)}
.nl-lang-btn{background:transparent;border:1px solid var(--border);color:var(--muted);padding:.22rem .55rem;border-radius:6px;cursor:pointer;font-size:.72rem;font-weight:700;font-family:'Syne',sans-serif;letter-spacing:.06em;transition:border-color .2s,color .2s;line-height:1}
.nl-lang-btn:hover{border-color:var(--accent);color:var(--accent)}
.nl-footer{text-align:center;padding:2rem;color:var(--muted);font-size:.75rem;max-width:800px;margin:0 auto}
.nl-footer a{color:var(--muted)}
.nl-actions{display:flex;gap:.75rem;flex-wrap:wrap;align-items:center;max-width:800px;margin:1.5rem auto;padding:0 1.5rem}
.nl-actions button,.nl-actions a{background:transparent;border:1px solid var(--accent);color:var(--accent);border-radius:20px;padding:.4rem 1rem;font-size:.8rem;cursor:pointer;text-decoration:none;font-family:inherit;transition:background .2s,color .2s}
.nl-actions button:hover,.nl-actions a:hover{background:var(--accent);color:#000}
.nl-subscribe-section{max-width:800px;margin:1.5rem auto 3rem;padding:0 1.5rem}
.nl-subscribe-card{background:rgba(200,169,110,.07);border:1px solid rgba(200,169,110,.25);border-radius:14px;padding:1.5rem}
.nl-subscribe-card h3{font-family:'Syne',sans-serif;font-size:1.05rem;color:var(--accent);margin-bottom:.4rem}
.nl-subscribe-card p{font-size:.85rem;color:var(--muted);margin-bottom:1rem}
.nl-sub-form{display:flex;gap:.5rem;flex-wrap:wrap}
.nl-sub-form input{flex:1;min-width:180px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:.45rem .75rem;border-radius:8px;font-family:inherit;font-size:.85rem}
.nl-sub-form button{background:var(--accent);color:#000;border:none;padding:.45rem 1.2rem;border-radius:8px;cursor:pointer;font-weight:700;font-size:.85rem}
#nl-sub-msg{font-size:.8rem;margin-top:.5rem;min-height:1.2em}
@media print{
  body{background:#fff;color:#111}
  :root{--bg:#fff;--surface:#f5f5f5;--border:#ccc;--accent:#8b6914;--text:#111;--muted:#555}
  .nl-header{border-bottom:1px solid #ccc}
  .nl-link-pill{border:1px solid #ccc;color:#333}
  nav,.no-print{display:none!important}
  @page{size:A4;margin:15mm}
  .nl-section{page-break-inside:avoid}
}
</style>
<script src="/assets/js/nav.js" defer></script>
</head>
<body>
${previewBanner}
<header class="nl-header">
  <a class="nl-header-logo" href="/">Amit Photos</a>
  <div style="display:flex;align-items:center;gap:.75rem">
    <span class="nl-header-meta">${escXml(dateStr)}</span>
    <button class="nl-lang-btn" id="nl-lang-btn" onclick="toggleLang()">EN</button>
  </div>
</header>
<h1 class="nl-issue-title" data-he="${escXml(issue.title_he)}" data-en="${escXml(issue.title_en || issue.title_he)}">${escXml(issue.title_he)}</h1>
${heroSection}
<hr class="nl-divider">
${newPhotosSection}
${newPhotosSection ? '<hr class="nl-divider">' : ''}
${galleryStripSection}
${saleBannerSection}
${(galleryStripSection || saleBannerSection) ? '<hr class="nl-divider">' : ''}
${guideSection}
${guideSection ? '<hr class="nl-divider">' : ''}
${locationSection}
${locationSection ? '<hr class="nl-divider">' : ''}
${tipSection}
${tipSection ? '<hr class="nl-divider">' : ''}
${linksSection}
${(tipSection || linksSection) ? '<hr class="nl-divider">' : ''}
${contactOutreachSection}
<footer class="nl-footer">
  <p>© Amit Photos | <a href="/">amitphotos.com</a></p>
</footer>
<div class="nl-actions no-print">
  <button onclick="window.print()">🖨 <span data-he="הדפס / שמור PDF" data-en="Print / Save PDF">הדפס / שמור PDF</span></button>
  <a href="${waHref}" target="_blank" rel="noopener">📲 <span data-he="שתף ב-WhatsApp" data-en="Share on WhatsApp">שתף ב-WhatsApp</span></a>
  <button onclick="copyLink()">🔗 <span id="copy-label" data-he="העתק קישור" data-en="Copy Link">העתק קישור</span></button>
</div>
<section class="nl-subscribe-section no-print">
  <div class="nl-subscribe-card">
    <h3 data-he="רוצה לקבל את הניוזלטר?" data-en="Want to receive the newsletter?">רוצה לקבל את הניוזלטר?</h3>
    <p data-he="גיליונות חודשיים — תמונות, מדריכים ומקומות צילום ישירות למייל." data-en="Monthly issues — photos, guides and shooting locations delivered to your inbox.">גיליונות חודשיים — תמונות, מדריכים ומקומות צילום ישירות למייל.</p>
    <form class="nl-sub-form" onsubmit="nlSubscribe(event)">
      <input type="email" id="nl-email" placeholder="כתובת המייל שלך" required>
      <button type="submit" data-he="הרשמה" data-en="Subscribe">הרשמה</button>
    </form>
    <p id="nl-sub-msg"></p>
    <div id="nl-unsub-wrap" style="margin-top:.6rem">
      <button class="nl-unsub-link" onclick="nlShowUnsub()" data-he="הסר אותי מהרשימה" data-en="Unsubscribe">הסר אותי מהרשימה</button>
    </div>
    <div id="nl-unsub-form" style="display:none;margin-top:.5rem">
      <form class="nl-sub-form" onsubmit="nlUnsubscribe(event)">
        <input type="email" id="nl-unsub-email" placeholder="כתובת המייל שלך" required>
        <button type="submit" style="background:#444;color:#fff" data-he="הסר" data-en="Remove">הסר</button>
      </form>
      <p id="nl-unsub-msg"></p>
    </div>
  </div>
</section>
<script>
function getLang(){return localStorage.getItem('lang')||'he'}
function applyLang(forceLang){if(window.__langChanging)return;window.__langChanging=true;const lang=forceLang||getLang();if(forceLang)localStorage.setItem('lang',forceLang);const isEn=lang==='en';document.documentElement.dir=isEn?'ltr':'rtl';document.documentElement.lang=lang;document.querySelectorAll('[data-he]').forEach(el=>{el.innerHTML=isEn?(el.dataset.en||el.dataset.he):el.dataset.he});const btn=document.getElementById('nl-lang-btn');if(btn)btn.textContent=isEn?'HE':'EN';if(typeof window.applyNavLang==='function')window.applyNavLang(lang);window.__langChanging=false}
function toggleLang(){applyLang(getLang()==='he'?'en':'he')}
applyLang();window.setLang=applyLang;window.addEventListener('storage',e=>{if(e.key==='lang')applyLang()})
function showStep(n){document.querySelectorAll('.nl-step-content').forEach((el,i)=>{el.style.display=(i+1===n)?'':'none'});document.querySelectorAll('.nl-step-pill').forEach((el,i)=>{el.classList.toggle('nl-step-active',i+1===n)})}
function copyLink(){navigator.clipboard.writeText(location.href).then(()=>{const el=document.getElementById('copy-label');const orig=el.innerHTML;el.textContent='✓ הועתק!';setTimeout(()=>{el.innerHTML=orig;applyLang()},2000)}).catch(()=>{})}
async function nlSubscribe(e){e.preventDefault();const email=document.getElementById('nl-email').value.trim();const msg=document.getElementById('nl-sub-msg');const btn=e.target.querySelector('button[type="submit"]');btn.disabled=true;try{const r=await fetch('/api/subscribers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});const d=await r.json();if(d.already){msg.style.color='#c8a96e';msg.textContent='כבר רשום/ה — תקבל את הגיליון הבא!'}else if(d.ok){msg.style.color='#4caf50';msg.textContent='נרשמת! תקבל את הגיליון הבא ישירות למייל 🎉';document.getElementById('nl-email').value=''}else{msg.style.color='#f44336';msg.textContent=d.error||'שגיאה'}}catch{msg.style.color='#f44336';msg.textContent='שגיאת רשת'}btn.disabled=false}
function nlShowUnsub(){document.getElementById('nl-unsub-form').style.display='';document.getElementById('nl-unsub-wrap').style.display='none'}
async function nlUnsubscribe(e){e.preventDefault();const email=document.getElementById('nl-unsub-email').value.trim();const msg=document.getElementById('nl-unsub-msg');const btn=e.target.querySelector('button[type="submit"]');btn.disabled=true;try{const r=await fetch('/api/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});const d=await r.json();if(d.ok&&d.notFound){msg.style.color='#c8a96e';msg.textContent='כתובת זו אינה ברשימה'}else if(d.ok){msg.style.color='#4caf50';msg.textContent='הוסרת מהרשימה בהצלחה'}else{msg.style.color='#f44336';msg.textContent=d.error||'שגיאה'}}catch{msg.style.color='#f44336';msg.textContent='שגיאת רשת'}btn.disabled=false}
</script>
</body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-cache' } });
}

async function handleAdminNlList(request, env) {
  if (!await checkAuth(request, env)) return new Response('Unauthorized', { status: 401 });

  const { results } = await env.DB.prepare(
    `SELECT id, slug, type, issue_number, title_he, status, published_at, created_at
     FROM newsletter_issues ORDER BY created_at DESC LIMIT 50`
  ).all();

  const rows = (results || []).map(issue => {
    const statusBadge = issue.status === 'published'
      ? `<span style="color:#4caf50">פורסם</span>`
      : `<span style="color:#ff9800">טיוטה</span>`;
    const date = issue.created_at ? issue.created_at.slice(0, 10) : '';
    const previewUrl = `/admin/newsletter/${escXml(issue.id)}/preview/`;
    return `<tr>
      <td>${escXml(String(issue.issue_number))}</td>
      <td>${statusBadge}</td>
      <td>${escXml(issue.type === 'full' ? 'מלא' : 'הבזק')}</td>
      <td>${escXml(issue.title_he)}</td>
      <td>${escXml(date)}</td>
      <td>
        <a href="/admin/newsletter/${escXml(issue.id)}/">ערוך</a> |
        <a href="${previewUrl}" target="_blank">תצוגה מקדימה</a> |
        <a href="#" onclick="showTestModal('${escXml(issue.id)}','${escXml(issue.slug)}');return false">שלח לבדיקה</a> |
        <a href="#" onclick="deleteAndRecreate('${escXml(issue.id)}','${escXml(issue.type)}');return false" style="color:#f44336">מחק ויצור מחדש</a>
        ${issue.status === 'published' ? ` | <a href="/newsletter/${escXml(issue.slug)}/" target="_blank">צפה</a>` : ''}
      </td>
    </tr>`;
  }).join('');

  return new Response(`<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ניהול ניוזלטר | Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Heebo',Arial,sans-serif;background:#0a0a0a;color:#f0ede8;padding:1.5rem;direction:rtl}
h1{font-size:1.4rem;color:#c8a96e;margin-bottom:1.25rem}
.actions{display:flex;gap:.75rem;margin-bottom:1.5rem;flex-wrap:wrap;align-items:center}
button{background:#c8a96e;color:#000;border:none;padding:.5rem 1.1rem;border-radius:8px;cursor:pointer;font-size:.85rem;font-weight:700}
button:disabled{opacity:.5;cursor:default}
.btn-back{background:transparent;color:#c8a96e;border:1px solid #c8a96e55;font-weight:600}
.btn-back:hover{border-color:#c8a96e}
#msg{font-size:.85rem;padding:.5rem;border-radius:6px;margin-bottom:1rem;display:none}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th,td{padding:.6rem .75rem;border-bottom:1px solid #222;text-align:right}
th{color:#888;font-weight:600}
a{color:#c8a96e;text-decoration:none}
a:hover{text-decoration:underline}
.modal-overlay{display:none;position:fixed;inset:0;background:#000a;z-index:100;align-items:center;justify-content:center}
.modal-overlay.open{display:flex}
.modal{background:#111;border:1px solid #333;border-radius:12px;padding:1.5rem;width:min(420px,90vw);direction:rtl}
.modal h2{font-size:1.1rem;color:#c8a96e;margin-bottom:1.25rem}
.modal label{display:block;font-size:.8rem;color:#888;margin-bottom:.35rem;margin-top:.9rem}
.modal input{width:100%;background:#0d0d0d;border:1px solid #333;color:#f0ede8;padding:.55rem .75rem;border-radius:7px;font-size:.9rem;font-family:inherit}
.modal input:focus{outline:none;border-color:#c8a96e55}
.modal-actions{display:flex;gap:.75rem;margin-top:1.25rem;flex-wrap:wrap}
.btn-wa{background:#25d366;color:#000}
.btn-cancel{background:transparent;color:#888;border:1px solid #333}
#test-msg{font-size:.82rem;margin-top:.75rem;min-height:1.2em}
.sub-card{background:#111;border:1px solid #222;border-radius:10px;margin-bottom:1.5rem;overflow:hidden}
.sub-header{display:flex;justify-content:space-between;align-items:center;padding:.75rem 1rem;cursor:pointer;user-select:none;color:#c8a96e;font-weight:700;font-size:.95rem}
.sub-header:hover{background:#181818}
.sub-table{width:100%;border-collapse:collapse;font-size:.82rem}
.sub-table th,.sub-table td{padding:.5rem .75rem;border-bottom:1px solid #1a1a1a;text-align:right}
.sub-table th{color:#666;font-weight:600}
.sub-table tr:last-child td{border-bottom:none}
.btn-del{background:none;border:none;color:#666;cursor:pointer;font-size:.9rem;padding:.2rem .5rem;border-radius:4px}
.btn-del:hover{color:#f44336;background:#2a0a0a}
</style>
</head>
<body>
<h1>ניהול ניוזלטר</h1>
<div class="actions">
  <a href="/admin/"><button type="button" class="btn-back">← חזרה לאדמין</button></a>
  <button onclick="generate('full')">📰 צור גיליון מלא</button>
  <button onclick="generate('flash')">⚡ צור הבזק</button>
</div>
<div id="msg"></div>

<div class="sub-card">
  <div class="sub-header" onclick="toggleSubs()">
    <span>👥 מנויים: <span id="sub-count">...</span></span>
    <span id="sub-toggle-icon">▼</span>
  </div>
  <div id="sub-body" style="display:none">
    <div style="padding:0 .5rem .5rem">
    <table class="sub-table">
      <thead><tr><th>שם</th><th>אימייל</th><th>תאריך</th><th></th></tr></thead>
      <tbody id="sub-rows"><tr><td colspan="4" style="text-align:center;color:#888;padding:1rem">טוען...</td></tr></tbody>
    </table>
    </div>
  </div>
</div>

<table>
  <thead><tr><th>#</th><th>סטטוס</th><th>סוג</th><th>כותרת</th><th>תאריך</th><th>פעולות</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#888;padding:2rem">אין גיליונות עדיין</td></tr>'}</tbody>
</table>

<div class="modal-overlay" id="test-modal">
  <div class="modal">
    <h2>שלח לבדיקה</h2>
    <label>שלח למייל</label>
    <input type="email" id="test-email" placeholder="email@example.com">
    <div class="modal-actions">
      <button onclick="sendTestEmail()">📧 שלח מייל</button>
      <button class="btn-wa" onclick="shareWhatsApp()">💬 שתף בווטסאפ</button>
      <button class="btn-cancel" onclick="closeTestModal()">ביטול</button>
    </div>
    <div id="test-msg"></div>
  </div>
</div>

<script>
let _testId = '', _testSlug = '';

function showTestModal(id, slug) {
  _testId = id; _testSlug = slug;
  document.getElementById('test-email').value = '';
  document.getElementById('test-msg').textContent = '';
  document.getElementById('test-modal').classList.add('open');
}
function closeTestModal() {
  document.getElementById('test-modal').classList.remove('open');
}
document.getElementById('test-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeTestModal(); });

async function sendTestEmail() {
  const email = document.getElementById('test-email').value.trim();
  const msgEl = document.getElementById('test-msg');
  if (!email) { msgEl.style.color='#f44336'; msgEl.textContent='הכנס כתובת מייל'; return; }
  msgEl.style.color='#888'; msgEl.textContent='שולח...';
  const tok = localStorage.getItem('session_token') || sessionStorage.getItem('session_token') || '';
  try {
    const r = await fetch('/api/admin/newsletter/' + _testId + '/send-test', {
      method: 'POST',
      headers: {'Content-Type':'application/json','X-Session-Token':tok},
      body: JSON.stringify({ email })
    });
    const d = await r.json();
    if (d.ok) { msgEl.style.color='#4caf50'; msgEl.textContent='✓ נשלח! בדוק את תיבת הדואר.'; }
    else { msgEl.style.color='#f44336'; msgEl.textContent='✗ ' + (d.error || 'שגיאה'); }
  } catch(e) { msgEl.style.color='#f44336'; msgEl.textContent='✗ שגיאת רשת'; }
}

function shareWhatsApp() {
  const previewUrl = 'https://amitphotos.com/admin/newsletter/' + _testId + '/preview/';
  const text = encodeURIComponent('תוכל להסתכל על הניוזלטר לפני פרסום? ' + previewUrl);
  window.open('https://wa.me/?text=' + text, '_blank');
}

async function generate(type) {
  const msg = document.getElementById('msg');
  const btns = document.querySelectorAll('button');
  btns.forEach(b => b.disabled = true);
  msg.style.cssText = 'display:block;background:#1a2a1a;color:#c8a96e;border:1px solid #c8a96e33;padding:.75rem 1rem;border-radius:8px;font-size:.95rem;margin-bottom:1rem';
  msg.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite;margin-left:.4rem">⏳</span> יוצר טיוטה עם Claude... (עד 30 שניות)';
  try {
    const r = await fetch('/api/admin/newsletter/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type })
    });
    const d = await r.json();
    if (d.skipped) {
      msg.style.cssText = 'display:block;background:#2a1a00;color:#ff9800;border:1px solid #ff980033;padding:.75rem 1rem;border-radius:8px;font-size:.95rem;margin-bottom:1rem';
      msg.textContent = 'גיליון לתקופה זו כבר קיים';
      btns.forEach(b => b.disabled = false);
    } else if (d.slug) {
      msg.style.cssText = 'display:block;background:#0a2a0a;color:#4caf50;border:1px solid #4caf5033;padding:.75rem 1rem;border-radius:8px;font-size:.95rem;margin-bottom:1rem';
      msg.textContent = '✓ נוצר בהצלחה! מעביר לעריכה...';
      setTimeout(() => location.href = '/admin/newsletter/' + d.id + '/', 800);
    } else {
      msg.style.cssText = 'display:block;background:#2a0a0a;color:#f44336;border:1px solid #f4433633;padding:.75rem 1rem;border-radius:8px;font-size:.95rem;margin-bottom:1rem';
      msg.textContent = '✗ ' + (d.error || 'שגיאה');
      btns.forEach(b => b.disabled = false);
    }
  } catch(e) {
    msg.style.cssText = 'display:block;background:#2a0a0a;color:#f44336;border:1px solid #f4433633;padding:.75rem 1rem;border-radius:8px;font-size:.95rem;margin-bottom:1rem';
    msg.textContent = '✗ שגיאת רשת: ' + e.message;
    btns.forEach(b => b.disabled = false);
  }
}

async function deleteAndRecreate(id, type) {
  if (!confirm('בטוח? הגיליון יימחק וייווצר גיליון חדש מאפס.')) return;
  const msg = document.getElementById('msg');
  const btns = document.querySelectorAll('button');
  btns.forEach(b => b.disabled = true);
  msg.style.cssText = 'display:block;background:#1a0a0a;color:#f44336;border:1px solid #f4433633;padding:.75rem 1rem;border-radius:8px;font-size:.95rem;margin-bottom:1rem';
  msg.textContent = 'מוחק...';
  const tok = localStorage.getItem('session_token') || sessionStorage.getItem('session_token') || '';
  try {
    const r = await fetch('/api/admin/newsletter/' + id, {
      method: 'DELETE',
      headers: {'X-Session-Token': tok}
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      msg.textContent = '✗ ' + (d.error || 'שגיאה במחיקה');
      btns.forEach(b => b.disabled = false);
      return;
    }
    await generate(type);
  } catch(e) {
    msg.textContent = '✗ שגיאת רשת: ' + e.message;
    btns.forEach(b => b.disabled = false);
  }
}

// ===== SUBSCRIBERS =====
let _subs = [], _subsLoaded = false;
function _nlTok() { var m = document.cookie.match(/(?:^|;\\s*)admin_session=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
function _escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function renderSubRows() {
  var tbody = document.getElementById('sub-rows');
  if (!Array.isArray(_subs) || !_subs.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;padding:1rem">אין מנויים עדיין</td></tr>';
    return;
  }
  tbody.innerHTML = _subs.map(function(s) {
    return '<tr><td>' + _escH(s.name) + '</td><td><a href="mailto:' + _escH(s.email) + '">' + _escH(s.email) + '</a></td><td>' + (s.created_at ? s.created_at.slice(0,10) : '') + '</td><td><button class="btn-del" onclick="deleteSub(\'' + _escH(s.id) + '\')">✕</button></td></tr>';
  }).join('');
}

async function deleteSub(id) {
  if (!confirm('למחוק מנוי זה?')) return;
  var r = await fetch('/api/subscribers?id=' + id, { method:'DELETE', headers:{'X-Session-Token':_nlTok()} });
  if (r.ok) {
    _subs = _subs.filter(function(s){ return s.id !== id; });
    document.getElementById('sub-count').textContent = _subs.length;
    renderSubRows();
  }
}

function toggleSubs() {
  var body = document.getElementById('sub-body');
  var icon = document.getElementById('sub-toggle-icon');
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  icon.textContent = open ? '▼' : '▲';
  if (!open && !_subsLoaded) loadSubsFull();
}

async function loadSubsFull() {
  if (_subsLoaded) { renderSubRows(); return; }
  var r = await fetch('/api/subscribers', { headers:{'X-Session-Token':_nlTok()} });
  if (!r.ok) { document.getElementById('sub-rows').innerHTML = '<tr><td colspan="4" style="color:#f44336;padding:1rem">שגיאת אימות</td></tr>'; return; }
  _subs = await r.json();
  _subsLoaded = true;
  renderSubRows();
}

(async function loadSubCount() {
  var r = await fetch('/api/subscribers', { headers:{'X-Session-Token':_nlTok()} });
  if (!r.ok) { document.getElementById('sub-count').textContent = '?'; return; }
  _subs = await r.json();
  _subsLoaded = true;
  document.getElementById('sub-count').textContent = Array.isArray(_subs) ? _subs.length : '?';
})();
</script>
<style>@keyframes spin{to{transform:rotate(360deg)}}</style>
</body></html>`, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}

async function handleAdminNlEditor(request, env, id) {
  if (!await checkAuth(request, env)) return new Response('Unauthorized', { status: 401 });
  const issue = await env.DB.prepare('SELECT * FROM newsletter_issues WHERE id=?').bind(id).first();
  if (!issue) return new Response('Not found', { status: 404 });
  const c = JSON.parse(issue.content_json || '{}');

  const field = (label, key, subkey, val) =>
    `<div class="field">
      <label>${escXml(label)}</label>
      <textarea name="${escXml(key + '.' + subkey)}" rows="3">${escXml(val || '')}</textarea>
    </div>`;

  const heroFields = c.hero ? `
    <h2 style="display:flex;justify-content:space-between;align-items:center"><span>תמונה ראשית</span><button type="button" class="btn-secondary" onclick="swapPhoto()" style="font-size:.75rem;padding:.3rem .7rem">🔄 החלף תמונה</button></h2>
    <div class="field"><label>Photo ID</label><input name="hero.photo_id" value="${escXml(c.hero.photo_id||'')}"></div>
    ${field('טקסט עברית','hero','text_he',c.hero.text_he)}
    ${field('טקסט אנגלית','hero','text_en',c.hero.text_en)}` : '';

  const guideFields = c.guide ? `
    <h2>מדריך החודש</h2>
    <div class="field"><label>Slug</label><input name="guide.slug" value="${escXml(c.guide.slug||'')}"></div>
    ${field('טקסט עברית','guide','text_he',c.guide.text_he)}
    ${field('טקסט אנגלית','guide','text_en',c.guide.text_en)}` : '';

  const locationFields = c.location ? `
    <h2>מקום לצילום</h2>
    ${field('טקסט עברית','location','text_he',c.location.text_he)}
    ${field('טקסט אנגלית','location','text_en',c.location.text_en)}` : '';

  const tipFields = c.tip ? `
    <h2 style="display:flex;justify-content:space-between;align-items:center"><span>טיפ החודש</span><button type="button" class="btn-secondary" onclick="regenTip()" style="font-size:.75rem;padding:.3rem .7rem">🎲 טיפ אחר</button></h2>
    ${field('כותרת עברית','tip','title_he',c.tip.title_he)}
    ${field('טקסט עברית','tip','text_he',c.tip.text_he)}
    ${field('טקסט אנגלית','tip','text_en',c.tip.text_en)}` : '';

  const saleFields = issue.type === 'full' ? `
  <h2>מבצע החודש</h2>
  <p style="font-size:.8rem;color:#888;margin-bottom:.75rem">המבצע אינו נוצר אוטומטית — מלא ידנית כאשר יש מבצע אמיתי להציע.</p>
  ${field('כותרת המבצע (עברית)', 'sale', 'title_he', c.sale?.title_he)}
  ${field('תיאור (עברית, עד 10 מילים)', 'sale', 'desc_he', c.sale?.desc_he)}
  ${field('מחיר מקורי', 'sale', 'original_price', c.sale?.original_price)}
  ${field('מחיר מבצע', 'sale', 'sale_price', c.sale?.sale_price)}
  ${field('תווית הנחה', 'sale', 'discount_label', c.sale?.discount_label)}` : '';

  const guideStepsFields = issue.type === 'full' && c.guide ? `
  <h2>שלבי המדריך</h2>
  ${[0, 1, 2].map(i => {
    const step = c.guide?.steps?.[i] || {};
    return `<div class="field"><label>שלב ${i+1} — כותרת</label>
      <input name="guide.steps.${i}.title_he" value="${escXml(step.title_he || '')}"></div>
    <div class="field"><label>שלב ${i+1} — טקסט</label>
      <textarea name="guide.steps.${i}.text_he" rows="3">${escXml(step.text_he || '')}</textarea></div>`;
  }).join('')}` : '';

  const publishBtn = issue.status === 'draft'
    ? `<button type="button" onclick="publish()">🚀 פרסם</button>`
    : `<span style="color:#4caf50">✓ פורסם ב-${escXml((issue.published_at||'').slice(0,10))}</span>`;

  const issuePublicUrl = `https://amitphotos.com/newsletter/${escXml(issue.slug)}/`;
  const fbShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent('https://amitphotos.com/newsletter/' + issue.slug + '/')}`;
  const sendSection = issue.status === 'published' ? `
<div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid #222;display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
  <button type="button" id="send-btn" onclick="sendToSubs()">📧 שלח לנרשמים (<span id="sub-count">...</span>)</button>
  <a href="${fbShareUrl}" target="_blank" rel="noopener" style="background:#1877f2;color:#fff;border:none;padding:.5rem 1.1rem;border-radius:8px;cursor:pointer;font-size:.85rem;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;gap:.4rem">
    <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.026 1.791-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
    שתף בפייסבוק
  </a>
  <span id="send-msg" style="font-size:.85rem;display:none"></span>
</div>` : '';

  return new Response(`<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>עורך ניוזלטר | Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Heebo',Arial,sans-serif;background:#0a0a0a;color:#f0ede8;padding:1.5rem;direction:rtl;max-width:800px}
h1{font-size:1.3rem;color:#c8a96e;margin-bottom:1rem}
h2{font-size:1rem;color:#c8a96e;margin:1.5rem 0 .75rem;border-bottom:1px solid #222;padding-bottom:.4rem}
.field{margin-bottom:1rem}
label{display:block;font-size:.8rem;color:#888;margin-bottom:.3rem}
input,textarea{width:100%;background:#111;border:1px solid #333;color:#f0ede8;padding:.5rem .75rem;border-radius:8px;font-family:inherit;font-size:.85rem;resize:vertical}
.actions{display:flex;gap:.75rem;margin:1.5rem 0;flex-wrap:wrap;align-items:center}
button{background:#c8a96e;color:#000;border:none;padding:.5rem 1.1rem;border-radius:8px;cursor:pointer;font-size:.85rem;font-weight:700}
.btn-secondary{background:#222;color:#f0ede8}
#msg{font-size:.85rem;padding:.5rem;border-radius:6px;margin-top:.5rem;display:none}
</style>
</head>
<body>
<h1>${escXml(issue.title_he)}</h1>
<div class="actions">
  <button onclick="save()">💾 שמור טיוטה</button>
  <a href="/admin/newsletter/${escXml(id)}/preview/" target="_blank"><button type="button" class="btn-secondary">👁 תצוגה מקדימה</button></a>
  ${publishBtn}
  <a href="/admin/newsletter/"><button type="button" class="btn-secondary">← חזרה לרשימה</button></a>
</div>
<div id="msg"></div>
${sendSection}
<div class="field" style="max-width:180px;margin-top:1rem"><label>מספר גיליון</label><input id="issue-number" type="number" value="${escXml(String(issue.issue_number || ''))}"></div>
${heroFields}${guideFields}${guideStepsFields}${locationFields}${tipFields}${saleFields}
<script>
const tok = localStorage.getItem('adminToken') || '';
${issue.status === 'published' ? `
fetch('/api/subscribers', { headers: {'X-Session-Token': tok} })
  .then(r => r.json())
  .then(d => { if (Array.isArray(d)) document.getElementById('sub-count').textContent = d.length; })
  .catch(() => {});
async function sendToSubs() {
  if (!confirm('לשלוח את הגיליון לכל הנרשמים?')) return;
  const btn = document.getElementById('send-btn');
  const msg = document.getElementById('send-msg');
  btn.disabled = true;
  msg.style.display = 'inline'; msg.style.color = '#888'; msg.textContent = 'שולח...';
  try {
    const r = await fetch('/api/admin/newsletter/${escXml(id)}/send', {
      method: 'POST', headers: {'X-Session-Token': tok}
    });
    const d = await r.json();
    if (d.ok) { msg.style.color = '#4caf50'; msg.textContent = 'נשלח ל-' + d.sent + ' נרשמים ✓'; }
    else { msg.style.color = '#f44336'; msg.textContent = d.error || 'שגיאה'; }
  } catch { msg.style.color = '#f44336'; msg.textContent = 'שגיאת רשת'; }
  btn.disabled = false;
}` : ''}
function collectContent() {
  const content = ${JSON.stringify(c)};
  document.querySelectorAll('input[name],textarea[name]').forEach(el => {
    const parts = el.name.split('.');
    // 2-part: section.key
    if (parts.length === 2) {
      const [section, key] = parts;
      if (!content[section]) content[section] = {};
      content[section][key] = el.value;
    }
    // 4-part: section.steps.index.key (e.g. guide.steps.0.title_he)
    else if (parts.length === 4 && parts[1] === 'steps') {
      const [section, , idxStr, key] = parts;
      const idx = parseInt(idxStr, 10);
      if (!content[section]) content[section] = {};
      if (!Array.isArray(content[section].steps)) content[section].steps = [];
      while (content[section].steps.length <= idx) content[section].steps.push({});
      content[section].steps[idx][key] = el.value;
    }
  });
  return content;
}
async function save() {
  const msg = document.getElementById('msg');
  msg.style.display = 'block'; msg.style.color = '#888'; msg.textContent = 'שומר...';
  const body = { content_json: JSON.stringify(collectContent()) };
  const issueNumEl = document.getElementById('issue-number');
  if (issueNumEl && issueNumEl.value !== '') body.issue_number = parseInt(issueNumEl.value, 10) || 0;
  const r = await fetch('/api/admin/newsletter/${escXml(id)}', {
    method: 'PATCH',
    headers: {'Content-Type':'application/json','X-Session-Token':tok},
    body: JSON.stringify(body)
  });
  const d = await r.json();
  msg.style.color = d.ok ? '#4caf50' : '#f44336';
  msg.textContent = d.ok ? 'נשמר!' : (d.error || 'שגיאה');
}
async function swapPhoto() {
  const msg = document.getElementById('msg');
  msg.style.display = 'block'; msg.style.color = '#888'; msg.textContent = 'מחליף תמונה...';
  try {
    const r = await fetch('/api/admin/newsletter/${escXml(id)}/swap-photo', { method: 'POST', headers: {'X-Session-Token': tok} });
    const d = await r.json();
    if (d.ok) { msg.style.color = '#4caf50'; msg.textContent = 'תמונה הוחלפה! טוען...'; setTimeout(() => location.reload(), 700); }
    else { msg.style.color = '#f44336'; msg.textContent = d.error || 'שגיאה'; }
  } catch { msg.style.color = '#f44336'; msg.textContent = 'שגיאת רשת'; }
}
async function regenTip() {
  const msg = document.getElementById('msg');
  msg.style.display = 'block'; msg.style.color = '#888'; msg.textContent = 'יוצר טיפ חדש...';
  try {
    const r = await fetch('/api/admin/newsletter/${escXml(id)}/regen-tip', { method: 'POST', headers: {'X-Session-Token': tok} });
    const d = await r.json();
    if (d.ok) { msg.style.color = '#4caf50'; msg.textContent = 'טיפ חדש! טוען...'; setTimeout(() => location.reload(), 700); }
    else { msg.style.color = '#f44336'; msg.textContent = d.error || 'שגיאה'; }
  } catch { msg.style.color = '#f44336'; msg.textContent = 'שגיאת רשת'; }
}
async function publish() {
  if (!confirm('לפרסם את הגיליון?')) return;
  const msg = document.getElementById('msg');
  msg.style.display = 'block'; msg.style.color = '#888'; msg.textContent = 'מפרסם...';
  const r = await fetch('/api/admin/newsletter/${escXml(id)}/publish', {
    method: 'POST', headers: {'X-Session-Token':tok}
  });
  const d = await r.json();
  if (d.url) { msg.style.color = '#4caf50'; msg.textContent = 'פורסם! מנתב...'; setTimeout(() => location.href = d.url, 800); }
  else { msg.style.color = '#f44336'; msg.textContent = d.error || 'שגיאה'; }
}
</script>
</body></html>`, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}

async function handleAdminNlGenerate(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  const { type } = await request.json().catch(() => ({}));
  if (!['full', 'flash'].includes(type)) return jsonRes({ error: 'type must be full or flash' }, 400, request);
  try {
    const result = await nlGenerateDraft(env, type);
    return jsonRes(result, 200, request);
  } catch(e) {
    return jsonRes({ error: e.message }, 500, request);
  }
}

async function handleAdminNlUpdate(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'PATCH') return jsonRes({ error: 'method not allowed' }, 405, request);
  const body = await request.json().catch(() => ({}));
  const issue = body.issue_number !== undefined
    ? await env.DB.prepare('SELECT type, title_he, title_en FROM newsletter_issues WHERE id=?').bind(id).first()
    : null;
  const updates = [];
  const binds = [];
  if (body.title_he !== undefined) { updates.push('title_he=?'); binds.push(body.title_he); }
  if (body.title_en !== undefined) { updates.push('title_en=?'); binds.push(body.title_en); }
  if (body.content_json !== undefined) { updates.push('content_json=?'); binds.push(body.content_json); }
  if (body.issue_number !== undefined) {
    updates.push('issue_number=?'); binds.push(body.issue_number);
    if (issue && issue.type === 'full') {
      const n = body.issue_number;
      const newHe = (issue.title_he || '').replace(/גיליון #\d+/, `גיליון #${n}`);
      const newEn = (issue.title_en || '').replace(/Issue #\d+/, `Issue #${n}`);
      if (newHe !== issue.title_he && !body.title_he) { updates.push('title_he=?'); binds.push(newHe); }
      if (newEn !== issue.title_en && !body.title_en) { updates.push('title_en=?'); binds.push(newEn); }
    }
  }
  if (!updates.length) return jsonRes({ error: 'no fields to update' }, 400, request);
  binds.push(id);
  await env.DB.prepare(`UPDATE newsletter_issues SET ${updates.join(',')} WHERE id=?`).bind(...binds).run();
  if (body.issue_number !== undefined)
    await nlSetSetting(env, 'nl_issue_number', String(Math.max(0, body.issue_number - 1)));
  return jsonRes({ ok: true }, 200, request);
}

async function handleAdminNlPublish(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  const issue = await env.DB.prepare('SELECT slug, status FROM newsletter_issues WHERE id=?').bind(id).first();
  if (!issue) return jsonRes({ error: 'not found' }, 404, request);
  await env.DB.prepare(
    `UPDATE newsletter_issues SET status='published', published_at=? WHERE id=?`
  ).bind(new Date().toISOString(), id).run();
  return jsonRes({ ok: true, url: `/newsletter/${issue.slug}/` }, 200, request);
}

async function handleAdminNlSwapPhoto(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  const issue = await env.DB.prepare('SELECT * FROM newsletter_issues WHERE id=?').bind(id).first();
  if (!issue) return jsonRes({ error: 'not found' }, 404, request);
  const c = JSON.parse(issue.content_json || '{}');
  const currentPhotoId = c.hero?.photo_id || '';
  const newPhoto = await env.DB.prepare(
    'SELECT id, title, url, thumbnail, category FROM photos WHERE published=1 AND id != ? ORDER BY RANDOM() LIMIT 1'
  ).bind(currentPhotoId).first();
  if (!newPhoto) return jsonRes({ error: 'no other photos available' }, 400, request);
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonRes({ error: 'ANTHROPIC_API_KEY not set' }, 500, request);
  const userPrompt = issue.type === 'full'
    ? `כתוב תוכן לניוזלטר צילום. החזר JSON בלבד:\n{"hero_text_he": "פסקה קצרה (2-3 משפטים) בעברית על התמונה", "hero_text_en": "same in English"}\n\nתמונה: "${newPhoto.title}" (קטגוריה: ${newPhoto.category || 'טבע'})`
    : `כתוב תוכן להבזק. החזר JSON בלבד:\n{"hero_text_he": "1-2 משפטים אישיים על התמונה", "hero_text_en": "same in English"}\n\nתמונה: "${newPhoto.title}" (קטגוריה: ${newPhoto.category || 'טבע'})`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-opus-4-7', max_tokens: 500,
      system: 'אתה כותב בשמו של עמית, צלם ישראלי. כתוב תמיד בגוף ראשון. החזר JSON תקין בלבד, ללא שום טקסט נוסף.',
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  if (!res.ok) return jsonRes({ error: `Claude API ${res.status}` }, 500, request);
  const data = await res.json();
  const raw = (data.content?.[0]?.text ?? '').trim();
  const jsonStr = raw.startsWith('```') ? raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '') : raw;
  let generated;
  try { generated = JSON.parse(jsonStr); } catch { return jsonRes({ error: 'Claude JSON parse failed' }, 500, request); }
  c.hero = {
    ...c.hero,
    photo_id: newPhoto.id,
    photo_url: toAbsolutePhotoUrl(newPhoto.url || newPhoto.thumbnail),
    title_he: newPhoto.title,
    category: newPhoto.category || '',
    text_he: generated.hero_text_he || c.hero?.text_he || '',
    text_en: generated.hero_text_en || c.hero?.text_en || ''
  };
  await env.DB.prepare('UPDATE newsletter_issues SET content_json=? WHERE id=?').bind(JSON.stringify(c), id).run();
  await nlSetSetting(env, 'nl_last_hero_id', newPhoto.id);
  return jsonRes({ ok: true }, 200, request);
}

async function handleAdminNlRegenTip(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  const issue = await env.DB.prepare('SELECT * FROM newsletter_issues WHERE id=?').bind(id).first();
  if (!issue) return jsonRes({ error: 'not found' }, 404, request);
  const c = JSON.parse(issue.content_json || '{}');
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonRes({ error: 'ANTHROPIC_API_KEY not set' }, 500, request);
  const userPrompt = `כתוב טיפ צילום מקורי ופרקטי. החזר JSON בלבד:\n{"tip_title_he": "כותרת קצרה (5-7 מילים)", "tip_title_en": "short tip title", "tip_text_he": "טיפ מקורי ופרקטי, 2-3 משפטים, לא גנרי", "tip_text_en": "same in English"}\n\nהקשר: תמונה "${c.hero?.title_he || ''}" (קטגוריה: ${c.hero?.category || 'טבע'})`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-opus-4-7', max_tokens: 400,
      system: 'אתה כותב בשמו של עמית, צלם ישראלי. כתוב תמיד בגוף ראשון. החזר JSON תקין בלבד, ללא שום טקסט נוסף.',
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  if (!res.ok) return jsonRes({ error: `Claude API ${res.status}` }, 500, request);
  const data = await res.json();
  const raw = (data.content?.[0]?.text ?? '').trim();
  const jsonStr = raw.startsWith('```') ? raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '') : raw;
  let generated;
  try { generated = JSON.parse(jsonStr); } catch { return jsonRes({ error: 'Claude JSON parse failed' }, 500, request); }
  c.tip = {
    title_he: generated.tip_title_he || c.tip?.title_he || 'טיפ החודש',
    title_en: generated.tip_title_en || c.tip?.title_en || '',
    text_he: generated.tip_text_he || c.tip?.text_he || '',
    text_en: generated.tip_text_en || c.tip?.text_en || ''
  };
  await env.DB.prepare('UPDATE newsletter_issues SET content_json=? WHERE id=?').bind(JSON.stringify(c), id).run();
  return jsonRes({ ok: true }, 200, request);
}

function nlBuildEmailHtml(issue, issueUrl, unsubscribeUrl, subscriberName) {
  const c = typeof issue.content_json === 'string'
    ? JSON.parse(issue.content_json || '{}')
    : (issue.content_json || {});
  const greeting = subscriberName
    ? `<p style="margin:0 0 16px;font-size:14px;color:#d0cdc8">שלום ${escXml(subscriberName)},</p>`
    : '';
  const heroHtml = c.hero ? `
    <img src="${escXml(c.hero.photo_url)}" alt="${escXml(c.hero.title_he)}" width="560" style="width:100%;max-width:560px;height:auto;display:block;border-radius:8px;margin-bottom:16px">
    <h2 style="margin:0 0 8px;font-size:18px;color:#c8a96e;font-family:Georgia,serif">${escXml(c.hero.title_he)}</h2>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#d0cdc8">${escXml(c.hero.text_he)}</p>` : '';
  const guideHtml = c.guide ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
      <tr><td style="background:#1a1a1a;border-radius:8px;padding:14px 16px">
        <div style="font-size:10px;color:#c8a96e;letter-spacing:.1em;margin-bottom:6px;text-transform:uppercase">מדריך החודש</div>
        <div style="font-size:14px;font-weight:700;color:#f0ede8;margin-bottom:6px">${escXml(c.guide.title_he)}</div>
        <p style="margin:0;font-size:13px;color:#999;line-height:1.6">${escXml(c.guide.text_he)}</p>
      </td></tr>
    </table>` : '';
  const tipHtml = c.tip ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
      <tr><td style="background:#1f1a10;border:1px solid #4a3a1a;border-radius:8px;padding:14px 16px">
        <div style="font-size:13px;font-weight:700;color:#c8a96e;margin-bottom:6px">${escXml(c.tip.title_he || 'טיפ החודש')}</div>
        <p style="margin:0;font-size:13px;color:#d0cdc8;line-height:1.6">${escXml(c.tip.text_he)}</p>
      </td></tr>
    </table>` : '';
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111;border-radius:12px;overflow:hidden">
      <tr><td style="background:#0a0a0a;padding:24px 32px;text-align:center;border-bottom:1px solid #222">
        <div style="color:#c8a96e;font-size:20px;font-weight:700;letter-spacing:.2em;font-family:Georgia,serif">AMIT PHOTOS</div>
        <div style="color:#888;font-size:11px;margin-top:4px">${escXml(issue.title_he)}</div>
      </td></tr>
      <tr><td style="padding:28px 32px;direction:rtl;text-align:right">
        ${greeting}${heroHtml}${guideHtml}${tipHtml}
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">
          <tr><td align="center">
            <a href="${escXml(issueUrl)}" style="display:inline-block;background:#c8a96e;color:#000;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none">קרא את הגיליון המלא ←</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:16px 32px 8px;text-align:center">
        <a href="https://ko-fi.com/amitphotos" style="display:inline-block;background:#f5f0e8;color:#7c5c2e;font-size:13px;font-weight:700;padding:10px 22px;border-radius:8px;text-decoration:none">&#9749; אהבת את הגיליון? קנה לי קפה</a>
      </td></tr>
      <tr><td style="padding:8px 32px 24px;text-align:center;border-top:1px solid #222;margin-top:8px">
        <p style="margin:8px 0 8px;color:#666;font-size:11px">קיבלת מייל זה כי נרשמת ל<a href="https://amitphotos.com" style="color:#c8a96e;text-decoration:none">amitphotos.com</a></p>
        <a href="${escXml(unsubscribeUrl)}" style="color:#888;font-size:12px;text-decoration:underline">Unsubscribe / הסר אותי מהרשימה</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

async function handleAdminNlDelete(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'DELETE') return jsonRes({ error: 'method not allowed' }, 405, request);
  const issue = await env.DB.prepare('SELECT id FROM newsletter_issues WHERE id=?').bind(id).first();
  if (!issue) return jsonRes({ error: 'not found' }, 404, request);
  await env.DB.prepare('DELETE FROM newsletter_issues WHERE id=?').bind(id).run();
  return jsonRes({ ok: true }, 200, request);
}

async function handleAdminNlSendTest(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  if (!env.RESEND_API_KEY) return jsonRes({ error: 'RESEND_API_KEY לא מוגדר' }, 500, request);
  const body = await request.json().catch(() => ({}));
  const email = (body.email || '').trim();
  if (!email) return jsonRes({ error: 'חסר כתובת מייל' }, 400, request);
  const issue = await env.DB.prepare('SELECT * FROM newsletter_issues WHERE id=?').bind(id).first();
  if (!issue) return jsonRes({ error: 'not found' }, 404, request);
  const origin = new URL(request.url).origin;
  const issueUrl = `${origin}/newsletter/${issue.slug}/`;
  const fromEmail = env.FROM_EMAIL || 'amit@amitphotos.com';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromEmail,
      to: email,
      subject: `[בדיקה] ${issue.title_he}`,
      html: nlBuildEmailHtml(issue, issueUrl, null, '')
    })
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    return jsonRes({ error: `שגיאת Resend: ${errBody.message || res.status}` }, 500, request);
  }
  return jsonRes({ ok: true }, 200, request);
}

async function handleAdminNlSend(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  if (!env.RESEND_API_KEY) return jsonRes({ error: 'RESEND_API_KEY לא מוגדר' }, 500, request);

  const issue = await env.DB.prepare('SELECT * FROM newsletter_issues WHERE id=?').bind(id).first();
  if (!issue) return jsonRes({ error: 'not found' }, 404, request);
  if (issue.status !== 'published') return jsonRes({ error: 'יש לפרסם את הגיליון לפני שליחה' }, 400, request);

  const { results: subscribers } = await env.DB.prepare('SELECT id, email, name FROM subscribers').all();
  if (!subscribers.length) return jsonRes({ error: 'אין נרשמים ברשימה' }, 400, request);

  const origin = new URL(request.url).origin;
  const issueUrl = `${origin}/newsletter/${issue.slug}/`;
  const fromEmail = env.FROM_EMAIL || 'amit@amitphotos.com';

  const batch = subscribers.map(sub => ({
    from: fromEmail,
    to: sub.email,
    subject: issue.title_he,
    html: nlBuildEmailHtml(issue, issueUrl, `${origin}/api/unsubscribe?token=${sub.id}`, sub.name)
  }));

  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(batch)
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    return jsonRes({ error: `שגיאת Resend: ${errBody.message || res.status}` }, 500, request);
  }

  const data = await res.json().catch(() => ({}));
  const sent = Array.isArray(data.data) ? data.data.length : subscribers.length;
  return jsonRes({ ok: true, sent }, 200, request);
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
    if (path === '/api/upload')            return handleUpload(request, env, ctx);
    if (path === '/api/repair-r2')         return handleRepairR2(request, env);
    if (path === '/api/track' && request.method === 'POST') return handleTrackEvent(request, env);
    if (path === '/api/pinterest/auth') return handlePinterestAuth(request, env);
    if (path === '/api/pinterest/callback') return handlePinterestCallback(request, env);
    if (path === '/api/pinterest/boards') return handlePinterestBoards(request, env);
    if (path === '/api/pinterest/status') return handlePinterestStatus(request, env);
    if (path === '/api/pinterest/post' && request.method === 'POST') return handlePinterestPost(request, env);
    if (path === '/api/pinterest/sync-all' && request.method === 'POST') return handlePinterestSyncAll(request, env);
    if (path === '/api/pinterest/sync-by-category' && request.method === 'POST') return handlePinterestSyncByCategory(request, env);
    if (path === '/api/pinterest/update-links' && request.method === 'POST') return handlePinterestUpdateLinks(request, env);
    if (path === '/api/pinterest/sync-en' && request.method === 'POST') return handlePinterestSyncEn(request, env);
    if (path === '/api/admin/photo-analytics') return handleAdminPhotoAnalytics(request, env);
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
    if (path === '/api/analyses/dedup' && request.method === 'POST')             return handleAnalysesDedup(request, env);
    if (path === '/api/analyses/publish-all' && request.method === 'POST')       return handleAnalysesPublishAll(request, env);
    if (path === '/api/analyses/generate' && request.method === 'POST')          return handleAnalysesGenerate(request, env);
    if (path.startsWith('/api/analyses/') && path.endsWith('/generate-en') && request.method === 'POST')
      return handleAnalysesGenerateEn(request, env, path.slice('/api/analyses/'.length).replace('/generate-en',''));
    if (path.startsWith('/api/analyses/') && request.method === 'GET')           return handleAnalysesGet(request, env, path.slice('/api/analyses/'.length));
    if (path.startsWith('/api/analyses/') && request.method === 'PUT')           return handleAnalysesUpdate(request, env, path.slice('/api/analyses/'.length));
    if (path.startsWith('/api/analyses/') && request.method === 'DELETE')        return handleAnalysesDelete(request, env, path.slice('/api/analyses/'.length));
    // Locations public API
    if (path === '/api/locations' && request.method === 'GET')          return handleLocationsList(request, env);
    if (path === '/api/locations/suggest' && request.method === 'POST') return handleLocationsSuggest(request, env);
    if (path.startsWith('/api/locations/') && request.method === 'GET') return handleLocationsGet(request, env, path.slice('/api/locations/'.length));
    // Locations admin API
    if (path === '/api/admin/locations' && request.method === 'GET')    return handleAdminLocationsList(request, env);
    if (path === '/api/admin/locations' && request.method === 'POST')   return handleAdminLocationsCreate(request, env);
    if (path.startsWith('/api/admin/locations/') && request.method === 'GET')
      return handleAdminLocationsGet(request, env, path.slice('/api/admin/locations/'.length).split('/')[0]);
    if (path.startsWith('/api/admin/locations/') && request.method === 'PUT') {
      const slug = path.slice('/api/admin/locations/'.length).split('/')[0];
      return handleAdminLocationsUpdate(request, env, slug);
    }
    if (path.startsWith('/api/admin/locations/') && request.method === 'POST') {
      const afterPrefix = path.slice('/api/admin/locations/'.length);
      const parts = afterPrefix.split('/');
      const locSlug = parts[0];
      if (parts[1] === 'generate-en') return handleAdminLocationsGenerateEn(request, env, locSlug);
      if (parts[1] === 'enrich') return handleAdminLocationsEnrich(request, env, locSlug);
      if (parts[1] === 'photos') {
        if (parts[2] === 'reorder') return handleAdminLocationPhotosReorder(request, env, locSlug);
        if (parts[2] && parts[3] === 'add-to-gallery') return handleAdminLocationPhotoAddToGallery(request, env, locSlug, parts[2]);
        if (parts[2] && parts[3] === 'forsale') {
          if (!await checkAuth(request, env)) return unauth(request);
          const { for_sale } = await request.json().catch(() => ({}));
          await env.DB.prepare('UPDATE location_photos SET for_sale = ? WHERE id = ? AND location_id = ?')
            .bind(for_sale ? 1 : 0, parts[2], locSlug).run();
          return jsonRes({ ok: true }, 200, request);
        }
        return handleAdminLocationPhotosAdd(request, env, locSlug);
      }
      return jsonRes({ error: 'לא נמצא' }, 404, request);
    }
    if (path.startsWith('/api/admin/locations/') && request.method === 'DELETE') {
      const afterPrefix = path.slice('/api/admin/locations/'.length);
      const parts = afterPrefix.split('/');
      if (parts[1] === 'photos' && parts[2]) {
        return handleAdminLocationPhotosDelete(request, env, parts[0], parts[2]);
      }
      return handleAdminLocationsDelete(request, env, parts[0]);
    }
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
    if (path.startsWith('/photo/'))        { trackPageView(env, request, 'photo'); return servePhotoPage(path.slice('/photo/'.length), env); }
    if (path.startsWith('/category/'))     { trackPageView(env, request, 'category'); return handleCategoryPage(decodeURIComponent(path.slice('/category/'.length)), env); }
    // Newsletter public routes
    if (path === '/newsletter' || path === '/newsletter/') return handleNlList(env);
    if (path.startsWith('/newsletter/') && path.length > '/newsletter/'.length) {
      const slug = path.slice('/newsletter/'.length).replace(/\/$/, '');
      return handleNlIssue(env, slug, false);
    }

    // Newsletter admin pages
    if (path === '/admin/newsletter' || path === '/admin/newsletter/') return handleAdminNlList(request, env);
    if (path.match(/^\/admin\/newsletter\/[^/]+\/preview\/?$/)) {
      const id = path.slice('/admin/newsletter/'.length).replace(/\/preview\/?$/, '');
      if (!await checkAuth(request, env)) return new Response('Unauthorized', { status: 401 });
      const issue = await env.DB.prepare('SELECT * FROM newsletter_issues WHERE id=?').bind(id).first();
      return issue ? handleNlIssue(env, issue.slug, true) : new Response('Not found', { status: 404 });
    }
    if (path.match(/^\/admin\/newsletter\/[^/]+\/?$/)) {
      const id = path.slice('/admin/newsletter/'.length).replace(/\/$/, '');
      return handleAdminNlEditor(request, env, id);
    }

    // Newsletter API routes
    if (path === '/api/admin/newsletter/generate' && request.method === 'POST') return handleAdminNlGenerate(request, env);
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+$/) && request.method === 'PATCH') {
      const id = path.slice('/api/admin/newsletter/'.length);
      return handleAdminNlUpdate(request, env, id);
    }
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+\/publish$/) && request.method === 'POST') {
      const id = path.slice('/api/admin/newsletter/'.length).replace(/\/publish$/, '');
      return handleAdminNlPublish(request, env, id);
    }
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+\/send$/) && request.method === 'POST') {
      const id = path.slice('/api/admin/newsletter/'.length).replace(/\/send$/, '');
      return handleAdminNlSend(request, env, id);
    }
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+\/send-test$/) && request.method === 'POST') {
      const id = path.slice('/api/admin/newsletter/'.length).replace(/\/send-test$/, '');
      return handleAdminNlSendTest(request, env, id);
    }
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+\/swap-photo$/) && request.method === 'POST') {
      const id = path.slice('/api/admin/newsletter/'.length).replace(/\/swap-photo$/, '');
      return handleAdminNlSwapPhoto(request, env, id);
    }
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+\/regen-tip$/) && request.method === 'POST') {
      const id = path.slice('/api/admin/newsletter/'.length).replace(/\/regen-tip$/, '');
      return handleAdminNlRegenTip(request, env, id);
    }
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+$/) && request.method === 'DELETE') {
      const id = path.slice('/api/admin/newsletter/'.length);
      return handleAdminNlDelete(request, env, id);
    }

    if (path.startsWith('/learn/') && path.length > '/learn/'.length)  { trackPageView(env, request, 'learn_detail'); return handleLearnAnalysis(env, decodeURIComponent(path.slice('/learn/'.length))); }
    if (path === '/learn' || path === '/learn/')   { trackPageView(env, request, 'learn'); return handleLearnIndex(env); }
    if (path === '/sitemap.xml')           return handleSitemap(request, env);
    if (path === '/robots.txt')            return handleRobots(request);

    // Server-side OG injection for location spot pages
    if ((path === '/locations/spot/' || path === '/locations/spot/index.html') && new URL(request.url).searchParams.get('slug')) {
      trackPageView(env, request, 'location');
      return handleLocationSpotPage(request, env);
    }

    // Static assets — track page views for HTML pages
    const res = await env.ASSETS.fetch(request);
    if (request.method === 'GET' && !path.startsWith('/api/') && (path === '/' || path.endsWith('.html') || path === '')) {
      // Map known static paths to page names
      const staticPage = path === '/' || path === '' ? 'home'
        : path.startsWith('/camera/') ? 'camera'
        : path.startsWith('/games/') || path.startsWith('/quiz/') || path.startsWith('/puzzle/') ? 'games'
        : path.startsWith('/sale/') ? 'sale'
        : path.startsWith('/locations/') ? 'locations'
        : 'other';
      trackPageView(env, request, staticPage);
    }

    // קבצים שמשתנים בכל deploy — תמיד לאמת עם השרת
    const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : '';
    const isHtml = ext === 'html' || ext === '' || path === '/'; // נתיבים ללא סיומת = HTML
    const isDynamic = isHtml || ['js', 'css', 'json'].includes(ext);
    if (isDynamic) {
      const newRes = new Response(res.body, res);
      newRes.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      newRes.headers.set('CDN-Cache-Control', 'no-store');
      newRes.headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
      return newRes;
    }

    return res;
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPinterestCronSync(env));
    ctx.waitUntil(runNewsletterCron(env));
  },
};

async function runPinterestCronSync(env) {
  try {
    const token = await getPinterestToken(env);
    if (!token) return;

    // סבב עברית — 1 לכל קטגוריה
    const { results: heResults } = await env.DB.prepare(`
      SELECT * FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY category ORDER BY created_at DESC) as rn
        FROM photos
        WHERE (pinterest_pin_id IS NULL OR pinterest_pin_id='') AND published=1 AND r2_key IS NOT NULL AND r2_key != ''
      ) WHERE rn <= 1
    `).all();

    for (const photo of heResults) {
      try {
        const boardId = await findOrCreateBoard(photo.category, env, token);
        if (!boardId) continue;
        const pinRes = await fetch('https://api.pinterest.com/v5/pins', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            link: `https://amitphotos.com/?photo=${photo.id}&buy=1`,
            title: photo.title || '',
            description: (photo.description || '') + '\n\nעמית ארז צילום | amitphotos.com',
            board_id: boardId,
            media_source: { source_type: 'image_url', url: toAbsolutePhotoUrl(photo.url) },
          }),
        });
        const pinData = await pinRes.json();
        if (pinData.id) await env.DB.prepare(`UPDATE photos SET pinterest_pin_id=? WHERE id=?`).bind(pinData.id, photo.id).run();
      } catch { /* silent */ }
      await new Promise(r => setTimeout(r, 600));
    }

    // הפסקה בין עברית לאנגלית
    await new Promise(r => setTimeout(r, 3000));

    // סבב אנגלית — 3 תמונות
    const { results: enResults } = await env.DB.prepare(
      `SELECT * FROM photos WHERE (pinterest_pin_id_en IS NULL OR pinterest_pin_id_en='') AND published=1 AND r2_key IS NOT NULL AND r2_key != '' ORDER BY created_at DESC LIMIT 3`
    ).all();

    for (const photo of enResults) {
      try {
        const [boardIdEn, titleEn] = await Promise.all([
          findOrCreateBoardEn(photo.category, env, token),
          translateTitleEn(photo.title, photo.description, photo.category, env),
        ]);
        if (!boardIdEn) continue;
        const englishCategory = HE_TO_EN_CATEGORY[photo.category] || photo.category;
        const pinRes = await fetch('https://api.pinterest.com/v5/pins', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            link: `https://amitphotos.com/?photo=${photo.id}&buy=1`,
            title: titleEn || `${englishCategory} | Amit Erez`,
            description: `Fine art photography by Israeli photographer Amit Erez.\n${englishCategory}. Available as high-quality prints at amitphotos.com.\n#photography #fineartphotography #israeliphotographer #amiterezphotography`,
            board_id: boardIdEn,
            media_source: { source_type: 'image_url', url: toAbsolutePhotoUrl(photo.url) },
          }),
        });
        const pinData = await pinRes.json();
        if (pinData.id) await env.DB.prepare(`UPDATE photos SET pinterest_pin_id_en=? WHERE id=?`).bind(pinData.id, photo.id).run();
      } catch { /* silent */ }
      await new Promise(r => setTimeout(r, 600));
    }
  } catch { /* silent */ }
}
