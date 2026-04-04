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
  await env.DB.prepare(
    `INSERT INTO photos (id,title,category,description,filename,r2_key,url,thumbnail,created_at) VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    id,
    formData.get('title') || '',
    formData.get('category') || '',
    formData.get('description') || '',
    file.name, key, url, thumbUrl,
    new Date().toISOString()
  ).run();

  return jsonRes({ ok: true, id, url, thumbnail: thumbUrl, key });
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
      const title = data.content?.[0]?.text?.replace(/[\*_`#\n\r]/g, '').trim().replace(/^['"]|['"]$/g, '');
      if (title) {
        await env.DB.prepare('UPDATE photos SET title=? WHERE id=?').bind(title, photo.id).run();
        updated.push({ id: photo.id, title });
      }
    } catch { /* המשך לתמונה הבאה */ }
  }

  return jsonRes({ updated: updated.length, total: toFill.length, titles: updated });
}

// ===== VERIFY PAYPAL PAYMENT =====
async function handleVerifyPayment(request, env) {
  if (request.method !== 'GET') return jsonRes({ error: 'method not allowed' }, 405, request);
  const url = new URL(request.url);
  const tx = url.searchParams.get('tx');
  const itemNumber = url.searchParams.get('item_number');
  const pdtToken = env.PAYPAL_PDT_TOKEN;

  if (!tx || !itemNumber) return jsonRes({ error: 'חסרים פרמטרים' }, 400, request);
  if (!pdtToken) return jsonRes({ error: 'PAYPAL_PDT_TOKEN לא מוגדר' }, 500, request);

  const lastUnderscore = itemNumber.lastIndexOf('_');
  if (lastUnderscore === -1) return jsonRes({ error: 'item_number לא תקין' }, 400, request);
  const fileId = itemNumber.substring(0, lastUnderscore);
  const size = itemNumber.substring(lastUnderscore + 1);
  const SIZE_MAP = { small: 'w1500', medium: 'w3000', large: null };
  if (!Object.prototype.hasOwnProperty.call(SIZE_MAP, size)) return jsonRes({ error: 'גודל לא תקין' }, 400, request);

  let paypalText;
  try {
    const res = await fetch('https://www.paypal.com/cgi-bin/webscr', {
      method: 'POST',
      body: new URLSearchParams({ cmd: '_notify-synch', tx, at: pdtToken }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    paypalText = await res.text();
  } catch {
    return jsonRes({ error: 'שגיאה בתקשורת עם PayPal' }, 502, request);
  }

  if (!paypalText.startsWith('SUCCESS')) return jsonRes({ error: 'התשלום לא אומת' }, 402, request);

  const lines = paypalText.split('\n');
  const txData = {};
  for (let i = 1; i < lines.length; i++) {
    const eq = lines[i].indexOf('=');
    if (eq !== -1) txData[decodeURIComponent(lines[i].substring(0, eq))] = decodeURIComponent(lines[i].substring(eq + 1));
  }
  if (txData['payment_status'] !== 'Completed') return jsonRes({ error: `סטטוס: ${txData['payment_status']}` }, 402, request);

  const sz = SIZE_MAP[size];
  const downloadUrl = sz
    ? `https://drive.google.com/thumbnail?id=${fileId}&sz=${sz}`
    : `https://drive.google.com/uc?export=download&id=${fileId}`;
  return jsonRes({ url: downloadUrl, title: txData['item_name'] || 'תמונה' }, 200, request);
}

// ===== PRINT SHOP =====

const PRINT_CATALOG = {
  photo: {
    label: 'הדפסה על נייר צילום',
    desc: 'נייר לוסטר איכותי, מוכן למסגור',
    attributes: {},
    sizes: [
      { label: '10×15 ס"מ (4×6")',  sku: 'GLOBAL-PAP-4X6',   w: 4,     h: 6,     wi: 4,     hi: 6     },
      { label: '13×18 ס"מ (5×7")',  sku: 'GLOBAL-PAP-5X7',   w: 5,     h: 7,     wi: 5,     hi: 7     },
      { label: '20×25 ס"מ (8×10")', sku: 'GLOBAL-PAP-8X10',  w: 8,     h: 10,    wi: 8,     hi: 10    },
      { label: 'A4 — 21×30 ס"מ',   sku: 'GLOBAL-PAP-A4',    w: 210,   h: 297,   wi: 8.27,  hi: 11.69 },
      { label: '28×35 ס"מ (11×14")',sku: 'GLOBAL-PAP-11X14', w: 11,    h: 14,    wi: 11,    hi: 14    },
      { label: '40×50 ס"מ (16×20")',sku: 'GLOBAL-PAP-16X20', w: 16,    h: 20,    wi: 16,    hi: 20    },
      { label: 'A3 — 30×42 ס"מ',   sku: 'GLOBAL-PAP-A3',    w: 297,   h: 420,   wi: 11.69, hi: 16.54 },
    ]
  },
  canvas: {
    label: 'הדפסה על קנבס',
    desc: 'קנבס מתוח על מסגרת עץ, מוכן לתלייה',
    attributes: { wrap: 'ImageWrap' },
    sizes: [
      { label: '20×20 ס"מ', sku: 'GLOBAL-CAN-8X8',   w: 1,  h: 1,  wi: 8,  hi: 8  },
      { label: '20×25 ס"מ', sku: 'GLOBAL-CAN-8X10',  w: 8,  h: 10, wi: 8,  hi: 10 },
      { label: '30×40 ס"מ', sku: 'GLOBAL-CAN-12X16', w: 3,  h: 4,  wi: 12, hi: 16 },
      { label: '40×50 ס"מ', sku: 'GLOBAL-CAN-16X20', w: 4,  h: 5,  wi: 16, hi: 20 },
      { label: '50×60 ס"מ', sku: 'GLOBAL-CAN-20X24', w: 5,  h: 6,  wi: 20, hi: 24 },
    ]
  },
  poster: {
    label: 'פוסטר — נייר אמנות מט',
    desc: 'נייר אמנות איכותי, פינישינג מט',
    attributes: {},
    sizes: [
      { label: 'A3 — 30×42 ס"מ', sku: 'GLOBAL-FAP-A3',    w: 297, h: 420, wi: 11.69, hi: 16.54 },
      { label: 'A2 — 42×59 ס"מ', sku: 'GLOBAL-FAP-A2',    w: 420, h: 594, wi: 16.54, hi: 23.39 },
      { label: '45×60 ס"מ',      sku: 'GLOBAL-FAP-18X24', w: 18,  h: 24,  wi: 18,    hi: 24    },
      { label: '60×90 ס"מ',      sku: 'GLOBAL-FAP-24X36', w: 24,  h: 36,  wi: 24,    hi: 36    },
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
  if (!env.PRODIGI_API_KEY) return jsonRes({ error: 'PRODIGI_API_KEY לא מוגדר' }, 500, request);

  // Find attributes for this SKU
  const typeEntry = Object.values(PRINT_CATALOG).find(t => t.sizes.some(s => s.sku === sku));
  const skuAttributes = typeEntry?.attributes || {};

  const res = await fetch('https://api.prodigi.com/v4.0/quotes', {
    method: 'POST',
    headers: { 'X-API-Key': env.PRODIGI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shippingMethod: 'Standard',
      destinationCountryCode: 'IL',
      currencyCode: 'USD',
      items: [{ sku, copies: 1, attributes: skuAttributes, assets: [{ printArea: 'default' }] }]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return jsonRes({ error: err.detail || `שגיאת Prodigi: ${res.status}` }, 500, request);
  }

  const data = await res.json();
  const quote = data.quotes?.[0];
  if (!quote) return jsonRes({ error: 'לא התקבלה הצעת מחיר' }, 500, request);

  const prodigiCost = parseFloat(quote.costSummary?.totalCost?.amount || 0);
  // Markup: 2.5x total cost, rounded up to nearest $5
  const sellPrice = Math.ceil((prodigiCost * 2.5) / 5) * 5;
  return jsonRes({ sellPrice, sku }, 200, request);
}

async function handlePrintOrderComplete(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  const { tx, itemNumber } = await request.json().catch(() => ({}));
  if (!tx || !itemNumber) return jsonRes({ error: 'חסרים פרמטרים' }, 400, request);
  if (!env.PAYPAL_PDT_TOKEN) return jsonRes({ error: 'PDT token לא מוגדר' }, 500, request);

  // Parse: PRINT_{photoId}_{sku}
  if (!itemNumber.startsWith('PRINT_')) return jsonRes({ error: 'item_number לא תקין' }, 400, request);
  const rest = itemNumber.slice(6);
  const firstUnderscore = rest.indexOf('_');
  if (firstUnderscore === -1) return jsonRes({ error: 'item_number לא תקין' }, 400, request);
  const photoId = rest.substring(0, firstUnderscore);
  const sku = rest.substring(firstUnderscore + 1);

  // Verify PayPal
  let paypalText;
  try {
    const r = await fetch('https://www.paypal.com/cgi-bin/webscr', {
      method: 'POST',
      body: new URLSearchParams({ cmd: '_notify-synch', tx, at: env.PAYPAL_PDT_TOKEN }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    paypalText = await r.text();
  } catch { return jsonRes({ error: 'שגיאה בתקשורת עם PayPal' }, 502, request); }

  if (!paypalText.startsWith('SUCCESS')) return jsonRes({ error: 'התשלום לא אומת' }, 402, request);
  const txData = {};
  paypalText.split('\n').slice(1).forEach(line => {
    const eq = line.indexOf('=');
    if (eq !== -1) txData[decodeURIComponent(line.substring(0, eq))] = decodeURIComponent(line.substring(eq + 1));
  });
  if (txData['payment_status'] !== 'Completed') return jsonRes({ error: `סטטוס: ${txData['payment_status']}` }, 402, request);

  // Decode address from custom field
  let address;
  try { address = JSON.parse(atob(txData['custom'] || '')); }
  catch { return jsonRes({ error: 'נתוני כתובת חסרים' }, 400, request); }

  // Get photo URL from DB
  const origin = new URL(request.url).origin;
  const photo = await env.DB.prepare('SELECT url FROM photos WHERE id=?').bind(photoId).first();
  if (!photo) return jsonRes({ error: 'תמונה לא נמצאה' }, 404, request);
  const photoUrl = photo.url.startsWith('http') ? photo.url : `${origin}${photo.url}`;

  // Create Prodigi order
  const orderId = crypto.randomUUID();
  const prodigiRes = await fetch('https://api.prodigi.com/v4.0/orders', {
    method: 'POST',
    headers: { 'X-API-Key': env.PRODIGI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchantReference: orderId,
      shippingMethod: 'Standard',
      recipient: {
        name: address.name,
        email: address.email || '',
        phoneNumber: address.phone || '',
        address: {
          line1: address.line1,
          postalOrZipCode: address.zip,
          countryCode: 'IL',
          townOrCity: address.city,
        }
      },
      items: [{
        merchantReference: `item-${orderId}`,
        sku,
        copies: 1,
        sizing: 'fillPrintArea',
        attributes: typeEntry?.attributes || {},
        assets: [{ printArea: 'default', url: photoUrl }]
      }]
    })
  });

  if (!prodigiRes.ok) {
    const err = await prodigiRes.json().catch(() => ({}));
    return jsonRes({ error: `שגיאת Prodigi: ${err.detail || prodigiRes.status}` }, 500, request);
  }
  const pd = await prodigiRes.json();
  const prodigiOrderId = pd.order?.id || '';

  // Find human-readable product label
  const typeEntry = Object.values(PRINT_CATALOG).find(t => t.sizes.some(s => s.sku === sku));
  const sizeEntry = typeEntry?.sizes.find(s => s.sku === sku);
  const productLabel = typeEntry && sizeEntry ? `${typeEntry.label} — ${sizeEntry.label}` : sku;
  const sellPrice = parseFloat(txData['mc_gross'] || 0);

  await env.DB.prepare(
    `INSERT INTO print_orders (id, prodigi_order_id, photo_id, sku, product_label, sell_price, customer_name, customer_email, customer_phone, address_line1, address_city, address_zip, paypal_tx, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_production', ?)`
  ).bind(
    orderId, prodigiOrderId, photoId, sku, productLabel, sellPrice,
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
          <p style="color:#888;font-size:.9rem">זמן משלוח משוער: 7–14 ימי עסקים.</p>
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
      <tr><td style="padding:.4rem 0;color:#888">Prodigi ID</td><td style="font-size:.82rem;color:#aaa">${prodigiOrderId||'—'}</td></tr>
    </table>
  </div>
</body></html>`;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to: adminEmail, subject: `הזמנת הדפסה חדשה — ${address.name} ($${sellPrice})`, html: adminHtml })
    });
  }

  return jsonRes({ ok: true, orderId: prodigiOrderId || orderId }, 200, request);
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

  // Cancel at Prodigi
  if (order.prodigi_order_id) {
    await fetch(`https://api.prodigi.com/v4.0/orders/${order.prodigi_order_id}/actions/cancel`, {
      method: 'POST',
      headers: { 'X-API-Key': env.PRODIGI_API_KEY, 'Content-Type': 'application/json' }
    });
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
    if (path === '/api/forgot-password')   return handleForgotPassword(request, env);
    if (path === '/api/reset-password')    return handleResetPassword(request, env);
    if (path === '/api/subscribers')       return handleSubscribers(request, env);
    if (path === '/api/customers')         return handleCustomers(request, env);
    if (path === '/api/photos')            return handlePhotos(request, env);
    if (path === '/api/upload')            return handleUpload(request, env);
    if (path === '/api/fill-titles')       return handleFillTitles(request, env);
    if (path === '/api/trigger-workflow')  return handleTriggerWorkflow(request, env);
    if (path === '/api/newsletter')        return handleNewsletter(request, env);
    if (path === '/api/unsubscribe')       return handleUnsubscribe(request, env);
    if (path === '/api/reply')             return handleReply(request, env);
    if (path === '/api/verify-payment')    return handleVerifyPayment(request, env);
    if (path === '/api/print/catalog')        return handlePrintCatalog(request, env);
    if (path === '/api/print/quote')          return handlePrintQuote(request, env);
    if (path === '/api/print/order-complete') return handlePrintOrderComplete(request, env);
    if (path === '/api/print/cancel')         return handlePrintCancel(request, env);
    if (path === '/api/print/orders')         return handlePrintOrders(request, env);
    if (path === '/api/analytics')         return handleAnalytics(request, env);
    if (path.startsWith('/photos/'))       return servePhoto(path.slice('/photos/'.length), env);

    // Static assets — track page views for HTML pages
    const res = await env.ASSETS.fetch(request);
    if (request.method === 'GET' && !path.startsWith('/api/') && (path === '/' || path.endsWith('.html') || path === '')) {
      const ctx = { waitUntil: (p) => p }; // best-effort
      trackPageView(env, request);
    }
    return res;
  },
};
