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
      ? 'SELECT * FROM photos ORDER BY created_at DESC'
      : 'SELECT * FROM photos WHERE published=1 ORDER BY created_at DESC';
    const { results } = await env.DB.prepare(sql).all();
    return jsonRes(results);
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
    const { id, title, category, description, published } = await request.json().catch(() => ({}));
    if (!id) return jsonRes({ error: 'id חסר' }, 400);

    // פרסום/ביטול פרסום בלבד
    if (published !== undefined) {
      await env.DB.prepare('UPDATE photos SET published=? WHERE id=?').bind(published ? 1 : 0, id).run();
      return jsonRes({ ok: true, published: published ? 1 : 0 });
    }

    let finalTitle = title || '';
    // אם הכותרת גנרית — נסה לייצר עברית אוטומטית
    if (isGenericTitle(finalTitle)) {
      const row = await env.DB.prepare('SELECT r2_key FROM photos WHERE id=?').bind(id).first();
      if (row?.r2_key) {
        const origin = new URL(request.url).origin;
        const aiTitle = await generateHebrewTitle(`${origin}/photos/${row.r2_key}`, category || '', env);
        if (aiTitle) finalTitle = aiTitle;
      }
    }

    await env.DB.prepare(
      'UPDATE photos SET title=?,category=?,description=? WHERE id=?'
    ).bind(finalTitle, category||'', description||'', id).run();
    return jsonRes({ ok: true, title: finalTitle });
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

  await env.PHOTOS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'image/jpeg' },
  });

  // שמור thumbnail אם נשלח
  const thumb = formData.get('thumb');
  let thumbUrl = `/photos/${key}`;
  if (thumb && typeof thumb !== 'string') {
    const thumbKey = `thumb_${id}.jpg`;
    await env.PHOTOS.put(thumbKey, thumb.stream(), {
      httpMetadata: { contentType: 'image/jpeg' },
    });
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

  await env.DB.prepare(
    `INSERT INTO photos (id,title,category,description,filename,r2_key,url,thumbnail,width,height,created_at,published) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`
  ).bind(
    id, title, category,
    formData.get('description') || '',
    file.name, key, url, thumbUrl,
    width, height,
    new Date().toISOString()
  ).run();

  return jsonRes({ ok: true, id, url, thumbnail: thumbUrl, key, title });
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

  if (!photo?.r2_key) return jsonRes({ error: 'תמונה לא נמצאה' }, 404, request);

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

// ===== VERIFY PAYPAL PAYMENT (PDT — server-to-server) =====
async function handleVerifyPayment(request, env) {
  if (request.method !== 'GET') return jsonRes({ error: 'method not allowed' }, 405, request);
  const url = new URL(request.url);
  const params = url.searchParams;

  // PayPal שולח את כל הפרמטרים ב-return URL כשמוגדר rm=2
  const txnId        = params.get('txn_id') || params.get('tx');
  const itemNumber   = params.get('item_number');
  const paymentStatus = params.get('payment_status');
  const receiverId   = params.get('receiver_id');
  const mcCurrency   = params.get('mc_currency');

  if (!txnId)      return jsonRes({ error: 'חסר transaction ID' }, 400, request);
  if (!itemNumber) return jsonRes({ error: 'item_number חסר' }, 400, request);

  const PAYPAL_RECEIVER_ID = 'UQS28ADG97TPW';
  if (paymentStatus !== 'Completed') return jsonRes({ error: `סטטוס תשלום: ${paymentStatus || 'חסר'}` }, 402, request);
  if (receiverId !== PAYPAL_RECEIVER_ID) return jsonRes({ error: 'חשבון PayPal לא תואם' }, 402, request);
  if (mcCurrency !== 'ILS')            return jsonRes({ error: 'מטבע לא תואם' }, 402, request);

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
  const PRICES = { small: 19, medium: 59, large: 129 };
  const PRICE_OVERRIDES = { '1jmBaBvk8rKoV5rvARPayvd010U_CW_gp_small': 1 };
  const BUNDLE_MIN = 3;
  const BUNDLE_DISCOUNT = 0.1;
  const mcGross = parseFloat(params.get('mc_gross') || 0);
  const unitPrice = PRICES[size];
  const subtotal = photoIds.length * unitPrice;
  const discount = photoIds.length >= BUNDLE_MIN ? Math.round(subtotal * BUNDLE_DISCOUNT) : 0;
  const overrideKey = photoIds.length === 1 ? `${photoIds[0]}_${size}` : null;
  const expectedPrice = (overrideKey && PRICE_OVERRIDES[overrideKey] != null)
    ? PRICE_OVERRIDES[overrideKey]
    : subtotal - discount;

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
      'INSERT INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
    ).bind(token, JSON.stringify([photoId]), size, txnId, expires, now).run();
    tokens.push(token);
  }

  if (tokens.length === 1) {
    const photo = await env.DB.prepare('SELECT title FROM photos WHERE id = ?').bind(photoIds[0]).first();
    return jsonRes({ url: `/api/download/${tokens[0]}`, title: photo?.title || 'תמונה' }, 200, request);
  }

  const urlItems = await Promise.all(photoIds.map(async (photoId, i) => {
    const photo = await env.DB.prepare('SELECT title FROM photos WHERE id = ?').bind(photoId).first();
    return { url: `/api/download/${tokens[i]}`, title: photo?.title || `תמונה ${i + 1}` };
  }));
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
  const PAYPAL_RECEIVER_ID = 'UQS28ADG97TPW';

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

  const title    = photo?.title       || 'עמית ארז | צילום אמנותי';
  const desc     = photo?.description || 'תמונות אמנותיות דיגיטליות לרכישה — טבע, פורטרט, נופי ישראל ועוד.';
  const imageUrl = photo?.thumbnail   || photo?.url || 'https://amitphotos.com/assets/images/og-default.jpg';
  const pageUrl  = `https://amitphotos.com/photo/${photoId}`;
  const siteUrl  = `https://amitphotos.com/#photo-${photoId}`;

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>${title} | עמית ארז</title>
  <meta property="og:title" content="${title} | עמית ארז" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:locale" content="he_IL" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title} | עמית ארז" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="${imageUrl}" />
  <meta http-equiv="refresh" content="0; url=${siteUrl}" />
  <script>window.location.replace('${siteUrl}');</script>
</head>
<body></body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

async function servePhoto(key, env) {
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

  // דפים סטטיים
  const staticPages = [
    { loc: '/',            priority: '1.0', changefreq: 'weekly'  },
    { loc: '/#gallery',   priority: '0.9', changefreq: 'daily'   },
    { loc: '/#about',     priority: '0.6', changefreq: 'monthly' },
    { loc: '/#pricing',   priority: '0.7', changefreq: 'monthly' },
    { loc: '/#contact',   priority: '0.5', changefreq: 'monthly' },
  ];

  // תמונות מ-D1
  let photoUrls = [];
  try {
    const { results } = await env.DB.prepare(
      'SELECT id, title, thumbnail, category, created_at FROM photos WHERE published=1 ORDER BY created_at DESC LIMIT 1000'
    ).all();

    photoUrls = results.map(p => {
      const lastmod = p.created_at ? p.created_at.split('T')[0] : now;
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
    if (path === '/api/forgot-password')   return handleForgotPassword(request, env);
    if (path === '/api/reset-password')    return handleResetPassword(request, env);
    if (path === '/api/subscribers')       return handleSubscribers(request, env);
    if (path === '/api/customers')         return handleCustomers(request, env);
    if (path === '/api/photos')            return handlePhotos(request, env);
    if (path === '/api/upload')            return handleUpload(request, env);
    if (path === '/api/repair-r2')         return handleRepairR2(request, env);
    if (path === '/api/fill-titles')       return handleFillTitles(request, env);
    if (path === '/api/generate-alt')      return handleGenerateAlt(request, env);
    if (path === '/api/trigger-workflow')  return handleTriggerWorkflow(request, env);
    if (path === '/api/newsletter')        return handleNewsletter(request, env);
    if (path === '/api/unsubscribe')       return handleUnsubscribe(request, env);
    if (path === '/api/reply')             return handleReply(request, env);
    if (path === '/api/verify-payment')    return handleVerifyPayment(request, env);
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
    if (path.startsWith('/photos/'))       return servePhoto(path.slice('/photos/'.length), env);
    if (path.startsWith('/photo/'))        return servePhotoPage(path.slice('/photo/'.length), env);
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
      return newRes;
    }

    return res;
  },
};
