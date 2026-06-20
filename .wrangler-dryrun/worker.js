var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var GA_SNIPPET = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-XM6T3E8QWN&l=dataLayer"><\/script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-XM6T3E8QWN',{send_page_view:true});<\/script>`;
var ALLOWED_ORIGINS = ["https://amitphotos.com", "https://www.amitphotos.com"];
var SESSION_TTL_HOURS = 8;
var MAX_LOGIN_ATTEMPTS = 5;
var LOCKOUT_MINUTES = 15;
function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET,POST,DELETE,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Session-Token",
    "Vary": "Origin",
    "Cache-Control": "no-store"
  };
}
__name(corsHeaders, "corsHeaders");
function jsonRes(data, status = 200, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: request ? corsHeaders(request) : { "Content-Type": "application/json" }
  });
}
__name(jsonRes, "jsonRes");
function unauth(request) {
  return jsonRes({ error: "\u05DC\u05D0 \u05DE\u05D5\u05E8\u05E9\u05D4" }, 401, request);
}
__name(unauth, "unauth");
var SEC_HEADERS = {
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": [
    "default-src 'self' https://amitphotos.com",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob: https://www.google-analytics.com https://region1.google-analytics.com",
    "connect-src 'self' https://amitphotos.com https://analytics.google.com https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com",
    "frame-src https://www.google.com https://www.paypal.com https://www.openstreetmap.org",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'"
  ].join("; ")
};
function htmlRes(html, status = 200, cacheControl = "no-store") {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": cacheControl, ...SEC_HEADERS }
  });
}
__name(htmlRes, "htmlRes");
function slugify(text) {
  const map = {
    "\u05D0": "a",
    "\u05D1": "b",
    "\u05D2": "g",
    "\u05D3": "d",
    "\u05D4": "h",
    "\u05D5": "v",
    "\u05D6": "z",
    "\u05D7": "ch",
    "\u05D8": "t",
    "\u05D9": "y",
    "\u05DB": "k",
    "\u05DA": "k",
    "\u05DC": "l",
    "\u05DE": "m",
    "\u05DD": "m",
    "\u05E0": "n",
    "\u05DF": "n",
    "\u05E1": "s",
    "\u05E2": "a",
    "\u05E4": "p",
    "\u05E3": "p",
    "\u05E6": "tz",
    "\u05E5": "tz",
    "\u05E7": "k",
    "\u05E8": "r",
    "\u05E9": "sh",
    "\u05EA": "t"
  };
  return text.split("").map((c) => map[c] || c).join("").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
__name(slugify, "slugify");
async function checkAuth(request, env) {
  const token = request.headers.get("X-Session-Token") || (request.headers.get("Cookie") || "").match(/(?:^|;\s*)admin_session=([^;]+)/)?.[1];
  if (token) {
    const session = await env.DB.prepare(
      "SELECT token FROM sessions WHERE token=? AND expires_at > ?"
    ).bind(token, (/* @__PURE__ */ new Date()).toISOString()).first();
    return !!session;
  }
  const pwd = request.headers.get("X-Admin-Password");
  if (pwd && env.ADMIN_PASSWORD && pwd === env.ADMIN_PASSWORD) return true;
  return false;
}
__name(checkAuth, "checkAuth");
async function handleLogin(request, env) {
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = /* @__PURE__ */ new Date();
  const attempt = await env.DB.prepare(
    "SELECT count, last_attempt FROM login_attempts WHERE ip=?"
  ).bind(ip).first();
  if (attempt) {
    const lastTime = new Date(attempt.last_attempt);
    const minutesPassed = (now - lastTime) / 1e3 / 60;
    if (minutesPassed < LOCKOUT_MINUTES && attempt.count >= MAX_LOGIN_ATTEMPTS) {
      const remaining = Math.ceil(LOCKOUT_MINUTES - minutesPassed);
      return jsonRes({ error: `\u05E0\u05D7\u05E1\u05DE\u05EA. \u05E0\u05E1\u05D4 \u05E9\u05D5\u05D1 \u05D1\u05E2\u05D5\u05D3 ${remaining} \u05D3\u05E7\u05D5\u05EA.` }, 429, request);
    }
    if (minutesPassed >= LOCKOUT_MINUTES) {
      await env.DB.prepare("DELETE FROM login_attempts WHERE ip=?").bind(ip).run();
    }
  }
  const { password } = await request.json().catch(() => ({}));
  const storedPwd = await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind("admin_password").first().catch(() => null);
  const correctPassword = storedPwd?.value || env.ADMIN_PASSWORD;
  if (!password || password !== correctPassword) {
    await env.DB.prepare(
      `INSERT INTO login_attempts (ip, count, last_attempt) VALUES (?,1,?)
       ON CONFLICT(ip) DO UPDATE SET count=count+1, last_attempt=excluded.last_attempt`
    ).bind(ip, now.toISOString()).run();
    return jsonRes({ error: "\u05E1\u05D9\u05E1\u05DE\u05D4 \u05E9\u05D2\u05D5\u05D9\u05D4" }, 401, request);
  }
  await env.DB.prepare("DELETE FROM login_attempts WHERE ip=?").bind(ip).run();
  const token = crypto.randomUUID();
  const expires = new Date(now.getTime() + SESSION_TTL_HOURS * 3600 * 1e3).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (token, created_at, expires_at) VALUES (?,?,?)"
  ).bind(token, now.toISOString(), expires).run();
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now.toISOString()).run();
  return jsonRes({ ok: true, token }, 200, request);
}
__name(handleLogin, "handleLogin");
async function handleForgotPassword(request, env) {
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  if (!env.RESEND_API_KEY) return jsonRes({ error: "RESEND_API_KEY \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8" }, 500, request);
  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 30 * 60 * 1e3).toISOString();
  await env.DB.prepare(
    `INSERT INTO reset_tokens (token, expires_at) VALUES (?,?)
     ON CONFLICT(token) DO UPDATE SET expires_at=excluded.expires_at`
  ).bind(token, expires).run();
  await env.DB.prepare("DELETE FROM reset_tokens WHERE expires_at < ?").bind((/* @__PURE__ */ new Date()).toISOString()).run();
  const origin = new URL(request.url).origin;
  const resetUrl = `${origin}/admin.html?reset=${token}`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Amit Photos <onboarding@resend.dev>",
      to: ["erez.family@gmail.com"],
      subject: "\u05D0\u05D9\u05E4\u05D5\u05E1 \u05E1\u05D9\u05E1\u05DE\u05D4 \u2014 Amit Photos",
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#c8a96e">Amit Photos \u2014 \u05D0\u05D9\u05E4\u05D5\u05E1 \u05E1\u05D9\u05E1\u05DE\u05D4</h2>
        <p>\u05E7\u05D9\u05D1\u05DC\u05E0\u05D5 \u05D1\u05E7\u05E9\u05D4 \u05DC\u05D0\u05D9\u05E4\u05D5\u05E1 \u05D4\u05E1\u05D9\u05E1\u05DE\u05D4 \u05E9\u05DC\u05DA.</p>
        <p>\u05DC\u05D7\u05E5 \u05E2\u05DC \u05D4\u05DB\u05E4\u05EA\u05D5\u05E8 \u05DC\u05D4\u05D2\u05D3\u05E8\u05EA \u05E1\u05D9\u05E1\u05DE\u05D4 \u05D7\u05D3\u05E9\u05D4. \u05D4\u05E7\u05D9\u05E9\u05D5\u05E8 \u05EA\u05E7\u05E3 \u05DC-30 \u05D3\u05E7\u05D5\u05EA.</p>
        <a href="${resetUrl}" style="display:inline-block;margin:1.5rem 0;padding:.75rem 2rem;background:#c8a96e;color:#0a0a0a;text-decoration:none;border-radius:4px;font-weight:bold">\u05D0\u05E4\u05E1 \u05E1\u05D9\u05E1\u05DE\u05D4</a>
        <p style="color:#888;font-size:.85rem">\u05D0\u05DD \u05DC\u05D0 \u05D1\u05D9\u05E7\u05E9\u05EA \u05D0\u05D9\u05E4\u05D5\u05E1, \u05D4\u05EA\u05E2\u05DC\u05DD \u05DE\u05DE\u05D9\u05D9\u05DC \u05D6\u05D4.</p>
      </div>`
    })
  });
  return jsonRes({ ok: true }, 200, request);
}
__name(handleForgotPassword, "handleForgotPassword");
async function handleResetPassword(request, env) {
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  const { token, new_password } = await request.json().catch(() => ({}));
  if (!token || !new_password) return jsonRes({ error: "\u05E4\u05E8\u05D8\u05D9\u05DD \u05D7\u05E1\u05E8\u05D9\u05DD" }, 400, request);
  if (new_password.length < 6) return jsonRes({ error: "\u05D4\u05E1\u05D9\u05E1\u05DE\u05D4 \u05D7\u05D9\u05D9\u05D1\u05EA \u05DC\u05D4\u05DB\u05D9\u05DC \u05DC\u05E4\u05D7\u05D5\u05EA 6 \u05EA\u05D5\u05D5\u05D9\u05DD" }, 400, request);
  const row = await env.DB.prepare(
    "SELECT token FROM reset_tokens WHERE token=? AND expires_at > ?"
  ).bind(token, (/* @__PURE__ */ new Date()).toISOString()).first().catch(() => null);
  if (!row) return jsonRes({ error: "\u05D4\u05E7\u05D9\u05E9\u05D5\u05E8 \u05E4\u05D2 \u05EA\u05D5\u05E7\u05E3 \u05D0\u05D5 \u05D0\u05D9\u05E0\u05D5 \u05EA\u05E7\u05D9\u05DF" }, 401, request);
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('admin_password', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).bind(new_password).run();
  await env.DB.prepare("DELETE FROM reset_tokens WHERE token=?").bind(token).run();
  await env.DB.prepare("DELETE FROM sessions").run();
  return jsonRes({ ok: true }, 200, request);
}
__name(handleResetPassword, "handleResetPassword");
async function handleLogout(request, env) {
  const token = request.headers.get("X-Session-Token");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token=?").bind(token).run();
  return jsonRes({ ok: true }, 200, request);
}
__name(handleLogout, "handleLogout");
async function handleFreeGuide(request, env) {
  const photo = await env.DB.prepare(
    `SELECT id, r2_key, title FROM photos WHERE published=1 AND r2_key IS NOT NULL AND r2_key != '' ORDER BY RANDOM() LIMIT 1`
  ).first();
  const photoUrl = photo?.r2_key ? `https://amitphotos.com/photos/${photo.r2_key}` : "";
  const photoTitle = (photo?.title || "").replace(/"/g, "&quot;");
  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>50 \u05D8\u05D9\u05E4\u05D9\u05DD \u05DC\u05E6\u05D9\u05DC\u05D5\u05DD \u05D8\u05D5\u05D1 \u05D9\u05D5\u05EA\u05E8 \u2014 PDF \u05D7\u05D9\u05E0\u05DD | Amit Photos</title>
<meta name="description" content="50 \u05D8\u05D9\u05E4\u05D9\u05DD \u05DC\u05E6\u05D9\u05DC\u05D5\u05DD \u05E9\u05D9\u05E9\u05E4\u05E8\u05D5 \u05D0\u05EA \u05D4\u05EA\u05DE\u05D5\u05E0\u05D5\u05EA \u05E9\u05DC\u05DA \u2014 PDF \u05D7\u05D9\u05E0\u05DE\u05D9 \u05D1-15 \u05E2\u05DE', \u05D9\u05E9\u05D9\u05E8 \u05DC\u05DE\u05D9\u05D9\u05DC.">
<meta property="og:title" content="50 \u05D8\u05D9\u05E4\u05D9\u05DD \u05DC\u05E6\u05D9\u05DC\u05D5\u05DD \u05D8\u05D5\u05D1 \u05D9\u05D5\u05EA\u05E8 \u2014 PDF \u05D7\u05D9\u05E0\u05DD">
<meta property="og:description" content="\u05D4\u05DE\u05D3\u05E8\u05D9\u05DA \u05E9\u05D4\u05DB\u05E0\u05EA\u05D9 \u05DE\u05D4\u05E0\u05D9\u05E1\u05D9\u05D5\u05DF \u05E9\u05DC\u05D9 \u05D5\u05D4\u05D0\u05D4\u05D1\u05D4 \u05DC\u05E6\u05DC\u05DD \u2014 15 \u05E2\u05DE\u05D5\u05D3\u05D9\u05DD, \u05D9\u05E9\u05D9\u05E8 \u05DC\u05DE\u05D9\u05D9\u05DC.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://amitphotos.com/free-guide/">
<meta property="og:locale" content="he_IL">${photoUrl ? `
<meta property="og:image" content="${photoUrl}">
<meta property="og:image:alt" content="50 \u05D8\u05D9\u05E4\u05D9\u05DD \u05DC\u05E6\u05D9\u05DC\u05D5\u05DD \u2014 \u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="50 \u05D8\u05D9\u05E4\u05D9\u05DD \u05DC\u05E6\u05D9\u05DC\u05D5\u05DD \u05D8\u05D5\u05D1 \u05D9\u05D5\u05EA\u05E8 \u2014 PDF \u05D7\u05D9\u05E0\u05DD">
<meta name="twitter:description" content="\u05D4\u05DE\u05D3\u05E8\u05D9\u05DA \u05E9\u05D4\u05DB\u05E0\u05EA\u05D9 \u05DE\u05D4\u05E0\u05D9\u05E1\u05D9\u05D5\u05DF \u05E9\u05DC\u05D9 \u05D5\u05D4\u05D0\u05D4\u05D1\u05D4 \u05DC\u05E6\u05DC\u05DD \u2014 15 \u05E2\u05DE\u05D5\u05D3\u05D9\u05DD, \u05D9\u05E9\u05D9\u05E8 \u05DC\u05DE\u05D9\u05D9\u05DC.">${photoUrl ? `
<meta name="twitter:image" content="${photoUrl}">` : ""}
${GA_SNIPPET}
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Heebo',sans-serif;background:#111;color:#f0ede8;min-height:100vh;display:flex;align-items:center;justify-content:center}
.wrap{display:flex;max-width:860px;width:100%;min-height:100vh}
.left{flex:1;background:${photoUrl ? `url('${photoUrl}') center/cover no-repeat` : "linear-gradient(135deg,#1a1a2e,#0f3460)"};min-height:300px}
.right{flex:1;padding:3rem 2.5rem;display:flex;flex-direction:column;justify-content:center;direction:rtl}
.badge{font-size:.7rem;letter-spacing:.15em;color:#c8a96e;text-transform:uppercase;margin-bottom:.6rem}
h1{font-size:1.9rem;line-height:1.25;margin-bottom:.5rem;color:#f0ede8}
.sub{font-size:.95rem;color:#aaa;margin-bottom:.4rem}
.pdf-meta{font-size:.75rem;color:#666;margin-bottom:1.8rem}
input[type=email]{width:100%;padding:.75rem 1rem;background:#1e1e1e;border:1px solid #444;border-radius:4px;color:#f0ede8;font-size:1rem;margin-bottom:.75rem;direction:rtl}
input[type=email]::placeholder{color:#666}
button{width:100%;padding:.8rem 1rem;background:#c8a96e;color:#111;border:none;border-radius:4px;font-size:1rem;font-weight:700;cursor:pointer}
button:hover{background:#d4b87a}
.legal{font-size:.7rem;color:#f0ede8;font-weight:700;margin-top:.6rem;line-height:1.5}
.msg{margin-top:.75rem;min-height:1.2em;font-size:.9rem}
.msg.ok{color:#4caf7d}
.msg.err{color:#e05555}
.back{font-size:.75rem;color:#666;margin-top:1.5rem}
.back a{color:#888;text-decoration:none}
.back a:hover{color:#c8a96e}
@media(max-width:600px){.wrap{flex-direction:column}.left{min-height:220px}.right{padding:2rem 1.5rem}}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700&display=swap" rel="stylesheet">
</head>
<body>
<div class="wrap">
  <div class="left" title="${photoTitle}"></div>
  <div class="right">
    <div class="badge">\u05DE\u05EA\u05E0\u05D4 \u05D7\u05D9\u05E0\u05DE\u05D9\u05EA</div>
    <h1>50 \u05D8\u05D9\u05E4\u05D9\u05DD \u05DC\u05E6\u05D9\u05DC\u05D5\u05DD \u05D8\u05D5\u05D1 \u05D9\u05D5\u05EA\u05E8</h1>
    <p class="sub">\u05D4\u05DE\u05D3\u05E8\u05D9\u05DA \u05E9\u05D4\u05DB\u05E0\u05EA\u05D9 \u05DE\u05D4\u05E0\u05D9\u05E1\u05D9\u05D5\u05DF \u05E9\u05DC\u05D9 \u05D5\u05D4\u05D0\u05D4\u05D1\u05D4 \u05DC\u05E6\u05DC\u05DD</p>
    <p class="pdf-meta">PDF \xB7 15 \u05E2\u05DE&#39; \xB7 \u05D9\u05E9\u05D9\u05E8 \u05DC\u05DE\u05D9\u05D9\u05DC</p>
    <form id="fg-form">
      <input type="email" id="fg-email" placeholder="\u05DB\u05EA\u05D5\u05D1\u05EA \u05D4\u05DE\u05D9\u05D9\u05DC \u05E9\u05DC\u05DA" required autocomplete="email">
      <button type="submit" id="fg-btn">\u05E9\u05DC\u05D7 \u05DC\u05D9 \u05D0\u05EA \u05D4-PDF &#x2190;</button>
      <p class="legal">\u05E7\u05D1\u05DC\u05EA \u05D4-PDF + \u05D4\u05E8\u05E9\u05DE\u05D4 \u05DC\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8 \u05D4\u05D7\u05D5\u05D3\u05E9\u05D9 \u05E9\u05DC \u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6. \u05E0\u05D9\u05EA\u05DF \u05DC\u05D1\u05D8\u05DC \u05D1\u05DB\u05DC \u05E2\u05EA.</p>
      <p class="msg" id="fg-msg"></p>
    </form>
    <div class="back"><a href="https://amitphotos.com">&#x2190; \u05D7\u05D6\u05D5\u05E8 \u05DC\u05D0\u05EA\u05E8</a></div>
  </div>
</div>
<script>
document.getElementById('fg-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const email = document.getElementById('fg-email').value.trim();
  const btn = document.getElementById('fg-btn');
  const msg = document.getElementById('fg-msg');
  btn.disabled = true;
  btn.textContent = '...';
  try {
    const r = await fetch('/api/subscribers?source=lead_magnet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, lang: 'he' })
    });
    if (r.ok) {
      msg.className = 'msg ok';
      msg.innerHTML = '\u2713 \u05E0\u05E9\u05DC\u05D7! \u05D1\u05D3\u05D5\u05E7 \u05D0\u05EA \u05EA\u05D9\u05D1\u05EA \u05D4\u05D3\u05D5\u05D0\u05E8 \u05E9\u05DC\u05DA (\u05D2\u05DD spam).<br><a href="https://api.whatsapp.com/send?text=' + encodeURIComponent('\u05E7\u05D9\u05D1\u05DC\u05EA\u05D9 PDF \u05D7\u05D9\u05E0\u05DE\u05D9 \u05E2\u05DD 50 \u05D8\u05D9\u05E4\u05D9\u05DD \u05DC\u05E6\u05D9\u05DC\u05D5\u05DD \u{1F4F8} amitphotos.com/free-guide') + '" target="_blank" rel="noopener" style="display:inline-block;margin-top:.6rem;background:#25D366;color:#fff;padding:.4rem 1rem;border-radius:4px;text-decoration:none;font-size:.85rem">\u05E9\u05EA\u05E3 \u05E2\u05DD \u05D7\u05D1\u05E8 \u05E6\u05DC\u05DD \u05D1-WhatsApp</a>';
      document.getElementById('fg-email').value = '';
      btn.textContent = '\u05E0\u05E9\u05DC\u05D7 \u2713';
    } else {
      msg.className = 'msg err';
      msg.textContent = '\u05E9\u05D2\u05D9\u05D0\u05D4. \u05E0\u05E1\u05D4 \u05E9\u05D5\u05D1.';
      btn.disabled = false;
      btn.textContent = '\u05E9\u05DC\u05D7 \u05DC\u05D9 \u05D0\u05EA \u05D4-PDF \u2190';
    }
  } catch {
    msg.className = 'msg err';
    msg.textContent = '\u05E9\u05D2\u05D9\u05D0\u05EA \u05E8\u05E9\u05EA. \u05E0\u05E1\u05D4 \u05E9\u05D5\u05D1.';
    btn.disabled = false;
    btn.textContent = '\u05E9\u05DC\u05D7 \u05DC\u05D9 \u05D0\u05EA \u05D4-PDF \u2190';
  }
});
<\/script>
</body>
</html>`;
  return htmlRes(html);
}
__name(handleFreeGuide, "handleFreeGuide");
async function handleSubscribers(request, env) {
  const method = request.method;
  if (method === "POST") {
    await env.DB.prepare("ALTER TABLE subscribers ADD COLUMN source TEXT DEFAULT 'website'").run().catch(() => {
    });
    const { name, email, notes, lang } = await request.json().catch(() => ({}));
    if (!email) return jsonRes({ error: "\u05DE\u05D9\u05D9\u05DC \u05D7\u05E1\u05E8" }, 400, request);
    if (typeof email !== "string" || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return jsonRes({ error: "\u05DE\u05D9\u05D9\u05DC \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF" }, 400, request);
    if (name && (typeof name !== "string" || name.length > 120))
      return jsonRes({ error: "\u05E9\u05DD \u05D0\u05E8\u05D5\u05DA \u05DE\u05D3\u05D9" }, 400, request);
    const source = new URL(request.url).searchParams.get("source") || "website";
    const isEn = lang === "en";
    const pdfUrl = isEn ? "https://amitphotos.com/50tips-eng.pdf" : "https://amitphotos.com/50tips-heb.pdf";
    const existing = await env.DB.prepare("SELECT id FROM subscribers WHERE email = ?").bind(email).first();
    const isLeadMagnetSource = source === "lead_magnet" || source === "popup";
    if (existing) {
      if (isLeadMagnetSource && env.RESEND_API_KEY) {
        const fromEmail = env.FROM_EMAIL || "Amit Photos <amit@amitphotos.com>";
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: fromEmail,
            to: email,
            subject: isEn ? "Your PDF \u2014 50 Photography Tips" : "\u05D4\u05E0\u05D4 \u05D4-PDF \u05E9\u05DC\u05DA \u2014 50 \u05D8\u05D9\u05E4\u05D9\u05DD \u05DC\u05E6\u05D9\u05DC\u05D5\u05DD",
            html: isEn ? `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:2rem;background:#111;color:#f0ede8">
                  <h2 style="color:#c8a96e">AMIT PHOTOS</h2>
                  <h3>50 Photography Tips \u2014 Your PDF is ready!</h3>
                  <div style="text-align:center;margin:1.5rem 0">
                    <a href="${pdfUrl}" style="background:#c8a96e;color:#111;padding:.8rem 2rem;border-radius:4px;text-decoration:none;font-weight:700;font-size:1rem">Download PDF \u2192</a>
                  </div>
                  <p style="color:#aaa;font-size:.9rem">You'll also receive the monthly newsletter \u2014 photos, locations and guides.</p>
                  <hr style="border-color:#333;margin-top:2rem">
                  <p style="color:#666;font-size:.8rem">Unsubscribe: <a href="https://amitphotos.com/api/unsubscribe?token=${existing.id}" style="color:#888">click here</a></p>
                </div>` : `<div dir="rtl" style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:2rem;background:#111;color:#f0ede8">
                  <h2 style="color:#c8a96e">AMIT PHOTOS</h2>
                  <h3>50 \u05D8\u05D9\u05E4\u05D9\u05DD \u05DC\u05E6\u05D9\u05DC\u05D5\u05DD \u05D8\u05D5\u05D1 \u05D9\u05D5\u05EA\u05E8 \u2014 \u05D4PDF \u05E9\u05DC\u05DA \u05DE\u05D5\u05DB\u05DF!</h3>
                  <div style="text-align:center;margin:1.5rem 0">
                    <a href="${pdfUrl}" style="background:#c8a96e;color:#111;padding:.8rem 2rem;border-radius:4px;text-decoration:none;font-weight:700;font-size:1rem">\u05D4\u05D5\u05E8\u05D3 \u05D0\u05EA \u05D4-PDF \u2190</a>
                  </div>
                  <p style="color:#aaa;font-size:.9rem">\u05EA\u05E7\u05D1\u05DC \u05D2\u05DD \u05D0\u05EA \u05D4\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8 \u05D4\u05D7\u05D5\u05D3\u05E9\u05D9 \u2014 \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA, \u05DE\u05E7\u05D5\u05DE\u05D5\u05EA \u05D5\u05DE\u05D3\u05E8\u05D9\u05DB\u05D9\u05DD.</p>
                  <hr style="border-color:#333;margin-top:2rem">
                  <p style="color:#666;font-size:.8rem">\u05DC\u05D1\u05D9\u05D8\u05D5\u05DC \u05D4\u05E8\u05E9\u05DE\u05D4: <a href="https://amitphotos.com/api/unsubscribe?token=${existing.id}" style="color:#888">\u05DC\u05D7\u05E5 \u05DB\u05D0\u05DF</a></p>
                </div>`
          })
        }).catch(() => {
        });
      }
      return jsonRes({ ok: true, already: true }, 200, request);
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO subscribers (id, name, email, notes, source, created_at) VALUES (?,?,?,?,?,?)"
    ).bind(id, name || "", email, notes || "", source, (/* @__PURE__ */ new Date()).toISOString()).run();
    if (env.RESEND_API_KEY) {
      const fromEmail = env.FROM_EMAIL || "Amit Photos <amit@amitphotos.com>";
      const isLeadMagnet = source === "lead_magnet" || source === "popup";
      const subject = isLeadMagnet ? isEn ? "Your PDF \u2014 50 Photography Tips" : "\u05D4\u05E0\u05D4 \u05D4-PDF \u05E9\u05DC\u05DA \u2014 50 \u05D8\u05D9\u05E4\u05D9\u05DD \u05DC\u05E6\u05D9\u05DC\u05D5\u05DD" : isEn ? "Welcome to Amit Photos newsletter!" : "\u05D1\u05E8\u05D5\u05DA \u05D4\u05D1\u05D0 \u05DC\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8 \u05E9\u05DC \u05E2\u05DE\u05D9\u05EA \u05E4\u05D5\u05D8\u05D5\u05E1!";
      const confirmHtml = isLeadMagnet ? isEn ? `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:2rem;background:#111;color:#f0ede8">
              <h2 style="color:#c8a96e;font-family:sans-serif;margin-bottom:.5rem">AMIT PHOTOS</h2>
              <h3 style="margin-top:0">50 Photography Tips \u2014 Your PDF is ready!</h3>
              <p style="color:#ccc">Hello${name ? " " + name : ""},</p>
              <p style="color:#ccc">Thank you! Here is your download link:</p>
              <div style="text-align:center;margin:1.5rem 0">
                <a href="${pdfUrl}" style="background:#c8a96e;color:#111;padding:.8rem 2rem;border-radius:4px;text-decoration:none;font-weight:700;font-size:1rem">Download PDF \u2192</a>
              </div>
              <p style="color:#aaa;font-size:.9rem">You'll also receive my monthly newsletter \u2014 new photos, shooting locations and guides.</p>
              <hr style="margin-top:2rem;border-color:#333">
              <p style="color:#666;font-size:.8rem">Unsubscribe: <a href="https://amitphotos.com/api/unsubscribe?token=${id}" style="color:#888">click here</a></p>
            </div>` : `<div dir="rtl" style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:2rem;background:#111;color:#f0ede8">
              <h2 style="color:#c8a96e;font-family:sans-serif;margin-bottom:.5rem">AMIT PHOTOS</h2>
              <h3 style="margin-top:0">50 \u05D8\u05D9\u05E4\u05D9\u05DD \u05DC\u05E6\u05D9\u05DC\u05D5\u05DD \u05D8\u05D5\u05D1 \u05D9\u05D5\u05EA\u05E8 \u2014 \u05D4PDF \u05E9\u05DC\u05DA \u05DE\u05D5\u05DB\u05DF!</h3>
              <p style="color:#ccc">\u05E9\u05DC\u05D5\u05DD${name ? " " + name : ""},</p>
              <p style="color:#ccc">\u05EA\u05D5\u05D3\u05D4! \u05D4\u05E0\u05D4 \u05D4\u05E7\u05D9\u05E9\u05D5\u05E8 \u05DC\u05D4\u05D5\u05E8\u05D3\u05D4:</p>
              <div style="text-align:center;margin:1.5rem 0">
                <a href="${pdfUrl}" style="background:#c8a96e;color:#111;padding:.8rem 2rem;border-radius:4px;text-decoration:none;font-weight:700;font-size:1rem">\u05D4\u05D5\u05E8\u05D3 \u05D0\u05EA \u05D4-PDF \u2190</a>
              </div>
              <p style="color:#aaa;font-size:.9rem">\u05D1\u05E0\u05D5\u05E1\u05E3, \u05EA\u05E7\u05D1\u05DC \u05D0\u05EA \u05D4\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8 \u05D4\u05D7\u05D5\u05D3\u05E9\u05D9 \u05E9\u05DC\u05D9 \u2014 \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA \u05D7\u05D3\u05E9\u05D5\u05EA, \u05DE\u05E7\u05D5\u05DE\u05D5\u05EA \u05E6\u05D9\u05DC\u05D5\u05DD \u05D5\u05DE\u05D3\u05E8\u05D9\u05DB\u05D9\u05DD.</p>
              <hr style="margin-top:2rem;border-color:#333">
              <p style="color:#666;font-size:.8rem">\u05DC\u05D1\u05D9\u05D8\u05D5\u05DC \u05D4\u05E8\u05E9\u05DE\u05D4: <a href="https://amitphotos.com/api/unsubscribe?token=${id}" style="color:#888">\u05DC\u05D7\u05E5 \u05DB\u05D0\u05DF</a></p>
            </div>` : isEn ? `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:2rem;color:#111">
              <h2 style="color:#c8a96e;font-family:sans-serif">AMIT PHOTOS</h2>
              <p>Hello${name ? " " + name : ""},</p>
              <p>Thank you for subscribing to the Amit Photos newsletter! \u{1F389}</p>
              <p>You'll receive updates about new photos, exclusive deals and behind-the-scenes content \u2014 straight to your inbox.</p>
              <hr style="margin-top:2rem;border-color:#ddd">
              <p style="color:#999;font-size:.8rem">You received this email because you subscribed at <a href="https://amitphotos.com">amitphotos.com</a>.</p>
            </div>` : `<div dir="rtl" style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:2rem;color:#111">
              <h2 style="color:#c8a96e;font-family:sans-serif">AMIT PHOTOS</h2>
              <p>\u05E9\u05DC\u05D5\u05DD${name ? " " + name : ""},</p>
              <p>\u05EA\u05D5\u05D3\u05D4 \u05E9\u05E0\u05E8\u05E9\u05DE\u05EA \u05DC\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8 \u05E9\u05DC \u05E2\u05DE\u05D9\u05EA \u05E4\u05D5\u05D8\u05D5\u05E1! \u{1F389}</p>
              <p>\u05EA\u05E7\u05D1\u05DC \u05E2\u05D3\u05DB\u05D5\u05E0\u05D9\u05DD \u05E2\u05DC \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA \u05D7\u05D3\u05E9\u05D5\u05EA, \u05DE\u05D1\u05E6\u05E2\u05D9\u05DD \u05D1\u05DC\u05E2\u05D3\u05D9\u05D9\u05DD \u05D5\u05EA\u05D5\u05DB\u05DF \u05DE\u05D0\u05D7\u05D5\u05E8\u05D9 \u05D4\u05E7\u05DC\u05E2\u05D9\u05DD \u2014 \u05D9\u05E9\u05D9\u05E8\u05D5\u05EA \u05DC\u05DE\u05D9\u05D9\u05DC.</p>
              <hr style="margin-top:2rem;border-color:#ddd">
              <p style="color:#999;font-size:.8rem">\u05E7\u05D9\u05D1\u05DC\u05EA \u05DE\u05D9\u05D9\u05DC \u05D6\u05D4 \u05DB\u05D9 \u05E0\u05E8\u05E9\u05DE\u05EA \u05DC\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8 \u05E9\u05DC <a href="https://amitphotos.com">amitphotos.com</a>.</p>
            </div>`;
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromEmail, to: email, subject, html: confirmHtml })
      });
      if (!resendRes.ok) {
        console.error("Resend error (new subscriber):", resendRes.status, await resendRes.text());
      }
    }
    return jsonRes({ ok: true, id }, 200, request);
  }
  if (!await checkAuth(request, env)) return unauth(request);
  if (method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM subscribers ORDER BY created_at DESC"
    ).all();
    return jsonRes(results);
  }
  if (method === "DELETE") {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return jsonRes({ error: "id \u05D7\u05E1\u05E8" }, 400);
    await env.DB.prepare("DELETE FROM subscribers WHERE id=?").bind(id).run();
    return jsonRes({ ok: true });
  }
  return jsonRes({ error: "method not allowed" }, 405);
}
__name(handleSubscribers, "handleSubscribers");
async function handleCustomers(request, env) {
  const method = request.method;
  if (method === "POST") {
    const body = await request.json().catch(() => ({}));
    const { id, name, email, phone, date, type, status, subject, notes } = body;
    if (!name) return jsonRes({ error: "\u05E9\u05DD \u05D7\u05E1\u05E8" }, 400, request);
    if (typeof name !== "string" || name.length > 120) return jsonRes({ error: "\u05E9\u05DD \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF" }, 400, request);
    if (email && (typeof email !== "string" || email.length > 254)) return jsonRes({ error: "\u05DE\u05D9\u05D9\u05DC \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF" }, 400, request);
    if (subject && (typeof subject !== "string" || subject.length > 500)) return jsonRes({ error: "\u05E0\u05D5\u05E9\u05D0 \u05D0\u05E8\u05D5\u05DA \u05DE\u05D3\u05D9" }, 400, request);
    if (notes && (typeof notes !== "string" || notes.length > 2e3)) return jsonRes({ error: "\u05D4\u05D5\u05D3\u05E2\u05D4 \u05D0\u05E8\u05D5\u05DB\u05D4 \u05DE\u05D3\u05D9" }, 400, request);
    if (id) {
      if (!await checkAuth(request, env)) return unauth(request);
      await env.DB.prepare(
        `UPDATE customers SET name=?,email=?,phone=?,date=?,type=?,status=?,subject=?,notes=? WHERE id=?`
      ).bind(name, email || "", phone || "", date || "", type || "", status || "", subject || "", notes || "", id).run();
      return jsonRes({ ok: true, id }, 200, request);
    } else {
      const newId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO customers (id,name,email,phone,date,type,status,subject,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(newId, name, email || "", phone || "", date || "", type || "\u05E4\u05E0\u05D9\u05D9\u05D4", status || "\u05DE\u05DE\u05EA\u05D9\u05DF", subject || "", notes || "", (/* @__PURE__ */ new Date()).toISOString()).run();
      return jsonRes({ ok: true, id: newId }, 200, request);
    }
  }
  if (!await checkAuth(request, env)) return unauth(request);
  if (method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM customers ORDER BY created_at DESC"
    ).all();
    return jsonRes(results);
  }
  if (method === "DELETE") {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return jsonRes({ error: "id \u05D7\u05E1\u05E8" }, 400);
    await env.DB.prepare("DELETE FROM customers WHERE id=?").bind(id).run();
    return jsonRes({ ok: true });
  }
  return jsonRes({ error: "method not allowed" }, 405);
}
__name(handleCustomers, "handleCustomers");
async function handlePhotos(request, env) {
  const method = request.method;
  if (method === "GET") {
    const url = new URL(request.url);
    const adminAll = url.searchParams.get("admin") === "1";
    const slim = url.searchParams.get("slim") === "1";
    const q = url.searchParams.get("q") || "";
    const limitParam = parseInt(url.searchParams.get("limit")) || 0;
    if (adminAll && !await checkAuth(request, env)) return unauth(request);
    if (slim && adminAll) {
      const catFilter = url.searchParams.get("category") || "";
      const categoriesOnly = url.searchParams.get("categories_only") === "1";
      if (categoriesOnly) {
        const { results: catRows } = await env.DB.prepare(
          'SELECT DISTINCT category FROM photos WHERE category IS NOT NULL AND category != "" ORDER BY category'
        ).all();
        return jsonRes(catRows.map((r) => r.category), 200, request);
      }
      const sql2 = catFilter ? "SELECT id, title, category, thumbnail FROM photos WHERE category=? ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order ASC, created_at DESC" : "SELECT id, title, category, thumbnail FROM photos ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order ASC, created_at DESC";
      const { results: slimResults } = catFilter ? await env.DB.prepare(sql2).bind(catFilter).all() : await env.DB.prepare(sql2).all();
      return jsonRes(slimResults, 200, request);
    }
    let sql, params;
    if (q && !adminAll) {
      sql = `SELECT id, title, category, url, thumbnail FROM photos WHERE title LIKE ? AND published = 1 ORDER BY created_at DESC${limitParam ? " LIMIT ?" : ""}`;
      params = limitParam ? [`%${q}%`, limitParam] : [`%${q}%`];
      const { results: qResults } = await env.DB.prepare(sql).bind(...params).all();
      return jsonRes(qResults, 200, request);
    }
    sql = adminAll ? "SELECT * FROM photos ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order ASC, created_at DESC" : "SELECT * FROM photos WHERE published=1 ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order ASC, created_at DESC";
    const { results } = await env.DB.prepare(sql).all();
    const { results: settingsRows } = await env.DB.prepare(
      "SELECT key, value FROM settings WHERE key IN ('photo_of_week_id','photo_of_week_discount','photo_of_week_caption','photo_of_week_caption_en')"
    ).all();
    const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
    const weekPhotoId = settings["photo_of_week_id"] || "";
    const weekDiscount = parseFloat(settings["photo_of_week_discount"] || "0.25");
    const weekCaption = settings["photo_of_week_caption"] || "";
    const weekCaptionEn = settings["photo_of_week_caption_en"] || "";
    const photos = results.map((p) => ({
      ...p,
      is_week_photo: !!(weekPhotoId && p.id === weekPhotoId),
      week_photo_discount: weekPhotoId && p.id === weekPhotoId ? weekDiscount : 0,
      week_photo_caption: weekPhotoId && p.id === weekPhotoId ? weekCaption : "",
      week_photo_caption_en: weekPhotoId && p.id === weekPhotoId ? weekCaptionEn : ""
    }));
    return jsonRes(photos);
  }
  if (!await checkAuth(request, env)) return unauth(request);
  if (method === "POST") {
    const body = await request.json().catch(() => ({}));
    const { id, title, category, description, filename, r2_key, url, thumbnail } = body;
    if (!url) return jsonRes({ error: "url \u05D7\u05E1\u05E8" }, 400, request);
    const photoId = id || crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO photos (id,title,category,description,filename,r2_key,url,thumbnail,created_at) VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, category=excluded.category, description=excluded.description, url=excluded.url, thumbnail=excluded.thumbnail`
    ).bind(photoId, title || "", category || "", description || "", filename || "", r2_key || "", url, thumbnail || url, (/* @__PURE__ */ new Date()).toISOString()).run();
    return jsonRes({ ok: true, id: photoId }, 200, request);
  }
  if (method === "PATCH") {
    if (!await checkAuth(request, env)) return unauth(request);
    const body = await request.json().catch(() => ({}));
    const { id } = body;
    if (!id) return jsonRes({ error: "id \u05D7\u05E1\u05E8" }, 400, request);
    if (body.published !== void 0) {
      await env.DB.prepare("UPDATE photos SET published=? WHERE id=?").bind(body.published ? 1 : 0, id).run();
      return jsonRes({ ok: true, published: body.published ? 1 : 0 }, 200, request);
    }
    if (body.quiz_eligible !== void 0 || body.quiz_description !== void 0) {
      const current = await env.DB.prepare("SELECT quiz_eligible, quiz_description FROM photos WHERE id=?").bind(id).first();
      if (!current) return jsonRes({ error: "\u05EA\u05DE\u05D5\u05E0\u05D4 \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D4" }, 404, request);
      const newEligible = body.quiz_eligible !== void 0 ? body.quiz_eligible ? 1 : 0 : current.quiz_eligible;
      const newDesc = body.quiz_description !== void 0 ? body.quiz_description : current.quiz_description;
      await env.DB.prepare("UPDATE photos SET quiz_eligible=?, quiz_description=? WHERE id=?").bind(newEligible, newDesc, id).run();
      return jsonRes({ ok: true, quiz_eligible: newEligible, quiz_description: newDesc }, 200, request);
    }
    if (body.on_sale !== void 0) {
      const newOnSale = body.on_sale ? 1 : 0;
      const startedAt = body.on_sale ? (/* @__PURE__ */ new Date()).toISOString() : null;
      await env.DB.prepare(
        "UPDATE photos SET on_sale=?, sale_started_at=? WHERE id=?"
      ).bind(newOnSale, startedAt, id).run();
      return jsonRes({ ok: true, on_sale: newOnSale }, 200, request);
    }
    let finalTitle = body.title || "";
    if (isGenericTitle(finalTitle)) {
      const row = await env.DB.prepare("SELECT r2_key FROM photos WHERE id=?").bind(id).first();
      if (row?.r2_key) {
        const origin = new URL(request.url).origin;
        const aiTitle = await generateHebrewTitle(`${origin}/photos/${row.r2_key}`, body.category || "", env);
        if (aiTitle) finalTitle = aiTitle;
      }
    }
    await env.DB.prepare(
      "UPDATE photos SET title=?,category=?,description=? WHERE id=?"
    ).bind(finalTitle, body.category || "", body.description || "", id).run();
    return jsonRes({ ok: true, title: finalTitle }, 200, request);
  }
  if (method === "DELETE") {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return jsonRes({ error: "id \u05D7\u05E1\u05E8" }, 400);
    const row = await env.DB.prepare("SELECT r2_key FROM photos WHERE id=?").bind(id).first();
    if (row?.r2_key) await env.PHOTOS.delete(row.r2_key);
    await env.DB.prepare("DELETE FROM photos WHERE id=?").bind(id).run();
    return jsonRes({ ok: true });
  }
  return jsonRes({ error: "method not allowed" }, 405);
}
__name(handlePhotos, "handlePhotos");
async function handleQuizPhotos(request, env) {
  const { results } = await env.DB.prepare(
    "SELECT id, title, category, thumbnail, url, quiz_description FROM photos WHERE published=1 AND quiz_eligible=1"
  ).all();
  const weekRow = await env.DB.prepare(
    "SELECT value FROM settings WHERE key='photo_of_week_id'"
  ).first();
  const weekId = weekRow?.value || "";
  const photos = results.map((p) => weekId && p.id === weekId ? { ...p, is_week_photo: true } : p);
  return jsonRes(photos);
}
__name(handleQuizPhotos, "handleQuizPhotos");
async function handleSalePhotos(request, env) {
  const { results } = await env.DB.prepare(
    "SELECT id, title, category, thumbnail, url, sale_started_at FROM photos WHERE published=1 AND on_sale=1 ORDER BY RANDOM()"
  ).all();
  return jsonRes(results, 200, request);
}
__name(handleSalePhotos, "handleSalePhotos");
async function handleSaleRotate(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const nextRotation = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString();
  await env.DB.prepare("UPDATE photos SET on_sale=0, sale_started_at=NULL WHERE on_sale=1").run();
  const { results } = await env.DB.prepare(
    "SELECT id FROM photos WHERE published=1 ORDER BY RANDOM() LIMIT 50"
  ).all();
  if (results.length === 0) return jsonRes({ error: "No published photos found" }, 400, request);
  const stmts = results.map(
    (photo) => env.DB.prepare("UPDATE photos SET on_sale=1, sale_started_at=? WHERE id=?").bind(now, photo.id)
  );
  await env.DB.batch(stmts);
  return jsonRes({ ok: true, rotated: results.length, next_rotation: nextRotation }, 200, request);
}
__name(handleSaleRotate, "handleSaleRotate");
async function handleRepairR2(request, env) {
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  if (!await checkAuth(request, env)) return unauth(request);
  const formData = await request.formData();
  const key = formData.get("key");
  const file = formData.get("file");
  if (!key || !file || typeof file === "string") return jsonRes({ error: "key/file \u05D7\u05E1\u05E8" }, 400, request);
  await env.PHOTOS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "image/jpeg" }
  });
  return jsonRes({ ok: true, key }, 200, request);
}
__name(handleRepairR2, "handleRepairR2");
async function handleUpload(request, env, ctx) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405);
  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") return jsonRes({ error: "\u05E7\u05D5\u05D1\u05E5 \u05D7\u05E1\u05E8" }, 400);
  const ext = file.name.split(".").pop().toLowerCase();
  const id = crypto.randomUUID();
  const key = `${id}.${ext}`;
  try {
    await env.PHOTOS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || "image/jpeg" }
    });
  } catch (e) {
    return jsonRes({ error: `R2 upload failed: ${e.message}` }, 500, request);
  }
  const thumb = formData.get("thumb");
  let thumbUrl = `/photos/${key}`;
  if (thumb && typeof thumb !== "string") {
    const thumbKey = `thumb_${id}.jpg`;
    try {
      await env.PHOTOS.put(thumbKey, thumb.stream(), {
        httpMetadata: { contentType: "image/jpeg" }
      });
    } catch {
    }
    thumbUrl = `/photos/${thumbKey}`;
  }
  const url = `/photos/${key}`;
  const category = formData.get("category") || "";
  let title = formData.get("title") || "";
  const width = parseInt(formData.get("width") || "0", 10) || null;
  const height = parseInt(formData.get("height") || "0", 10) || null;
  if (isGenericTitle(title)) {
    const origin = new URL(request.url).origin;
    const aiTitle = await generateHebrewTitle(`${origin}${url}`, category, env);
    if (aiTitle) title = aiTitle;
  }
  const published = formData.get("published") === "1" ? 1 : 0;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO photos (id,title,category,description,filename,r2_key,url,thumbnail,width,height,created_at,added_at,published) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id,
      title,
      category,
      formData.get("description") || "",
      file.name,
      key,
      url,
      thumbUrl,
      width,
      height,
      now,
      now.slice(0, 10),
      published
    ).run();
  } catch (e) {
    return jsonRes({ error: `DB insert failed: ${e.message}` }, 500, request);
  }
  if (ctx) {
    const photoForPin = { url, thumbnail: thumbUrl, title, category, description: formData.get("description") || "" };
    ctx.waitUntil(autoPostPhotoToPinterest(id, photoForPin, env));
  }
  return jsonRes({ ok: true, id, url, thumbnail: thumbUrl, key, title });
}
__name(handleUpload, "handleUpload");
function dispatchWorkflow(workflow, env) {
  if (!env.GITHUB_TOKEN) return;
  fetch(
    `https://api.github.com/repos/erezfamily-cmyk/amit-photos/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "amit-photos-worker",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({ ref: "main" })
    }
  ).catch(() => {
  });
}
__name(dispatchWorkflow, "dispatchWorkflow");
async function handleTriggerWorkflow(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405);
  if (!env.GITHUB_TOKEN) return jsonRes({ error: "GITHUB_TOKEN \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8" }, 500);
  const body = await request.json().catch(() => ({}));
  const workflow = body.workflow || "update-photos.yml";
  const res = await fetch(
    `https://api.github.com/repos/erezfamily-cmyk/amit-photos/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "amit-photos-worker",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({ ref: "main" })
    }
  );
  if (res.status === 204) return jsonRes({ ok: true, message: "\u05D4\u05E1\u05E7\u05E8\u05D9\u05E4\u05D8 \u05D4\u05D5\u05E4\u05E2\u05DC \u05D1\u05D4\u05E6\u05DC\u05D7\u05D4" });
  const err = await res.text();
  return jsonRes({ error: `GitHub API: ${err}` }, res.status);
}
__name(handleTriggerWorkflow, "handleTriggerWorkflow");
async function handleBreakdown(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  if (!env.GITHUB_TOKEN) return jsonRes({ error: "GITHUB_TOKEN \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8" }, 500, request);
  const body = await request.json().catch(() => ({}));
  const { photo_id } = body;
  if (!photo_id) return jsonRes({ error: "\u05D7\u05E1\u05E8 photo_id" }, 400, request);
  const res = await fetch(
    "https://api.github.com/repos/erezfamily-cmyk/amit-photos/actions/workflows/photo-breakdown.yml/dispatches",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "amit-photos-worker",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({ ref: "main", inputs: { photo_id } })
    }
  );
  if (res.status === 204) return jsonRes({
    ok: true,
    actions: "https://github.com/erezfamily-cmyk/amit-photos/actions/workflows/photo-breakdown.yml"
  }, 200, request);
  const err = await res.text();
  return jsonRes({ error: `GitHub API: ${err.slice(0, 200)}` }, res.status, request);
}
__name(handleBreakdown, "handleBreakdown");
async function handleReels(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (!env.GITHUB_TOKEN) return jsonRes({ error: "GITHUB_TOKEN \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8" }, 500, request);
  const GH = "https://api.github.com/repos/erezfamily-cmyk/amit-photos";
  const ghHeaders = {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "amit-photos-worker",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const { category, lang = "auto", photos = "", prompts = "" } = body;
    if (!category) return jsonRes({ error: "category \u05D7\u05E1\u05E8" }, 400, request);
    const res2 = await fetch(`${GH}/actions/workflows/reel-maker.yml/dispatches`, {
      method: "POST",
      headers: ghHeaders,
      body: JSON.stringify({ ref: "main", inputs: { category, lang, photos, prompts } })
    });
    if (res2.status !== 204) {
      const err = await res2.text();
      return jsonRes({ error: `GitHub (${res2.status}): ${err.slice(0, 200)}` }, 502, request);
    }
    return jsonRes({ ok: true }, 200, request);
  }
  const url = new URL(request.url);
  if (url.searchParams.get("latest")) {
    const res2 = await fetch(`${GH}/actions/workflows/reel-maker.yml/runs?per_page=1`, { headers: ghHeaders });
    const data = await res2.json();
    const run2 = data.workflow_runs?.[0];
    let download_url2 = null;
    try {
      const assetRes = await env.ASSETS.fetch(new Request("https://amitphotos.com/data/latest_reel.json"));
      if (assetRes.ok) {
        const reel = await assetRes.json();
        download_url2 = reel.url || null;
      }
    } catch {
    }
    return jsonRes({ run_id: run2?.id, status: run2?.status, download_url: download_url2 }, 200, request);
  }
  const runId = url.searchParams.get("run_id");
  if (!runId) return jsonRes({ error: "run_id \u05D0\u05D5 latest \u05D7\u05E1\u05E8" }, 400, request);
  const res = await fetch(`${GH}/actions/runs/${runId}`, { headers: ghHeaders });
  const run = await res.json();
  let download_url = null;
  if (run.status === "completed" && run.conclusion === "success") {
    try {
      const assetRes = await env.ASSETS.fetch(new Request("https://amitphotos.com/data/latest_reel.json"));
      if (assetRes.ok) {
        const reel = await assetRes.json();
        download_url = reel.url || null;
      }
    } catch {
    }
  }
  return jsonRes({
    status: run.status,
    conclusion: run.conclusion,
    run_url: run.html_url,
    download_url,
    artifact_url: run.status === "completed" && run.conclusion === "success" ? `${GH.replace("api.github.com/repos", "github.com")}/actions/runs/${runId}` : null
  }, 200, request);
}
__name(handleReels, "handleReels");
async function handleAdminVideos(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (!env.GITHUB_TOKEN) return jsonRes({ error: "GITHUB_TOKEN \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8" }, 500, request);
  const GH = "https://api.github.com/repos/erezfamily-cmyk/amit-photos";
  const ghHeaders = {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "amit-photos-worker",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const ct = request.headers.get("Content-Type") || "";
  if (request.method === "POST" && ct.includes("multipart/form-data")) {
    let formData;
    try {
      formData = await request.formData();
    } catch {
      return jsonRes({ error: "\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05E7\u05E8\u05D9\u05D0\u05EA \u05D4\u05E7\u05D5\u05D1\u05E5" }, 400, request);
    }
    const file = formData.get("file");
    if (!file || typeof file === "string") return jsonRes({ error: "\u05E7\u05D5\u05D1\u05E5 \u05D7\u05E1\u05E8" }, 400, request);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const shortId = crypto.randomUUID().split("-")[0];
    const key = `${shortId}-${safeName}`;
    await env.PHOTOS.put(`video/${key}`, file.stream(), {
      httpMetadata: { contentType: file.type || "video/mp4" },
      customMetadata: { originalName: file.name }
    });
    return jsonRes({ ok: true, key, filename: file.name }, 200, request);
  }
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const { key, filename } = body;
    let inputs;
    if (key) {
      const videoUrl = `https://amitphotos.com/video/${key}`;
      inputs = { video_url: videoUrl };
    } else if (filename) {
      inputs = { video_filename: filename };
    } else {
      return jsonRes({ error: "key \u05D0\u05D5 filename \u05D7\u05E1\u05E8" }, 400, request);
    }
    const res = await fetch(`${GH}/actions/workflows/distribute-video.yml/dispatches`, {
      method: "POST",
      headers: ghHeaders,
      body: JSON.stringify({ ref: "main", inputs })
    });
    if (res.status !== 204) {
      const err = await res.text();
      return jsonRes({ error: `GitHub (${res.status}): ${err.slice(0, 200)}` }, 502, request);
    }
    return jsonRes({ ok: true }, 200, request);
  }
  const [r2List, postedRes] = await Promise.all([
    env.PHOTOS.list({ prefix: "video/", include: ["customMetadata"] }),
    env.ASSETS.fetch(new Request("https://amitphotos.com/data/distributed_videos.json")).catch(() => null)
  ]);
  let posted = [];
  try {
    if (postedRes?.ok) posted = await postedRes.json();
  } catch {
  }
  const postedMap = {};
  for (const p of posted) postedMap[p.filename] = p;
  const videos = r2List.objects.map((obj) => {
    const key = obj.key.replace("video/", "");
    const postData = postedMap[key] || null;
    return {
      key,
      name: obj.customMetadata?.originalName || key,
      size: obj.size,
      uploaded: obj.uploaded,
      posted: !!postData,
      date: postData?.date || null,
      platforms: postData?.platforms || null
    };
  }).sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
  return jsonRes({ videos }, 200, request);
}
__name(handleAdminVideos, "handleAdminVideos");
async function handleVideoFile(request, env, key) {
  const r2Key = `video/${key}`;
  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    const object2 = await env.PHOTOS.get(r2Key, { range: rangeHeader });
    if (!object2) return new Response("Not found", { status: 404 });
    const { offset = 0, length = object2.size } = object2.range ?? {};
    return new Response(object2.body, {
      status: 206,
      headers: {
        "Content-Type": object2.httpMetadata?.contentType || "video/mp4",
        "Content-Range": `bytes ${offset}-${offset + length - 1}/${object2.size}`,
        "Content-Length": String(length),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400"
      }
    });
  }
  const object = await env.PHOTOS.get(r2Key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "video/mp4",
      "Content-Length": String(object.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400"
    }
  });
}
__name(handleVideoFile, "handleVideoFile");
async function handleReelsFile(request, env, filename) {
  if (!filename) return new Response("not found", { status: 404 });
  const obj = await env.PHOTOS.get(`reels/${filename}`);
  if (!obj) return new Response("\u05E7\u05D5\u05D1\u05E5 \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-cache"
    }
  });
}
__name(handleReelsFile, "handleReelsFile");
function isGenericTitle(title) {
  if (!title) return true;
  return !/[\u05D0-\u05EA]/.test(title);
}
__name(isGenericTitle, "isGenericTitle");
var HE_TO_EN_CATEGORY = {
  "\u05D8\u05D1\u05E2": "Nature Photography",
  "\u05E4\u05D5\u05E8\u05D8\u05E8\u05D8\u05D9\u05DD": "Portrait Photography",
  "\u05E2\u05D9\u05E8\u05D5\u05E0\u05D9": "Street Photography",
  "\u05D0\u05D9\u05E8\u05D5\u05E2\u05D9\u05DD": "Event Photography",
  "\u05D1\u05E2\u05DC\u05D9 \u05D7\u05D9\u05D9\u05DD": "Wildlife Photography",
  "\u05E4\u05E8\u05D7\u05D9\u05DD \u05D5\u05E6\u05DE\u05D7\u05D9\u05DD": "Flower Photography",
  "\u05D8\u05D1\u05E2 \u05D3\u05D5\u05DE\u05DD": "Still Life Photography",
  "\u05E6\u05D9\u05DC\u05D5\u05DD \u05DE\u05D5\u05E4\u05E9\u05D8": "Abstract Photography",
  "\u05DE\u05D0\u05E7\u05E8\u05D5-\u05E6\u05D9\u05DC\u05D5\u05DE\u05D9 \u05EA\u05E7\u05E8\u05D9\u05D1": "Macro Photography",
  "\u05D9\u05E9\u05E8\u05D0\u05DC": "Israel Photography",
  "\u05D0\u05D9\u05D8\u05DC\u05D9\u05D4": "Italy Photography",
  "\u05D0\u05E0\u05D2\u05DC\u05D9\u05D4": "England Photography",
  "\u05D2\u05E8\u05DE\u05E0\u05D9\u05D4": "Germany Photography",
  "\u05D4\u05D5\u05DC\u05E0\u05D3": "Netherlands Photography",
  "\u05D5\u05D9\u05E0\u05D4": "Vienna Photography",
  "\u05D9\u05D5\u05D5\u05DF": "Greece Photography",
  "\u05D8\u05E0\u05D6\u05E0\u05D9\u05D4": "Tanzania Photography",
  "\u05DE\u05D5\u05E0\u05D8\u05E0\u05D2\u05E8\u05D5": "Montenegro Photography",
  "\u05E1\u05DC\u05D5\u05D1\u05E7\u05D9\u05D4": "Slovakia Photography",
  '\u05E1\u05DF \u05D3\u05D9\u05D0\u05D2\u05D5 - \u05D0\u05E8\u05D4"\u05D1': "San Diego Photography",
  "\u05E1\u05E4\u05E8\u05D3 \u05D5\u05D0\u05E0\u05D3\u05D5\u05E8\u05D4": "Spain & Andorra Photography",
  "\u05E6\u05DB\u05D9\u05D4": "Czech Republic Photography",
  "\u05D0\u05D1\u05D5 \u05D3\u05D0\u05D1\u05D9": "Abu Dhabi Photography"
};
async function translateTitleEn(title, description, category, env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  try {
    const prompt = `Translate this Hebrew photo title to English for a Pinterest pin. Keep it short (2-6 words), evocative, and suitable for fine art photography.
Hebrew title: "${title}"
Category: "${HE_TO_EN_CATEGORY[category] || category}"
${description ? `Description hint (Hebrew): "${description}"` : ""}
Return ONLY the English title, nothing else.`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 20,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.[0]?.text?.trim().replace(/^["']|["']$/g, "") || null;
  } catch {
    return null;
  }
}
__name(translateTitleEn, "translateTitleEn");
async function findOrCreateBoardEn(categoryName, env, token) {
  const cacheKey = `pinterest_board_en_${categoryName}`;
  const cached = await env.DB.prepare(`SELECT value FROM settings WHERE key=?`).bind(cacheKey).first();
  if (cached) return cached.value;
  const englishName = HE_TO_EN_CATEGORY[categoryName] || `${categoryName} Photography`;
  const listRes = await fetch("https://api.pinterest.com/v5/boards?page_size=100", {
    headers: { "Authorization": `Bearer ${token}` }
  });
  if (!listRes.ok) return null;
  const listData = await listRes.json();
  const existing = listData.items?.find((b) => b.name.toLowerCase() === englishName.toLowerCase());
  if (existing) {
    await env.DB.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(cacheKey, existing.id).run();
    return existing.id;
  }
  const createRes = await fetch("https://api.pinterest.com/v5/boards", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: englishName, description: `Fine art photography by Amit Erez | amitphotos.com`, privacy: "PUBLIC" })
  });
  if (!createRes.ok) return null;
  const created = await createRes.json();
  if (!created.id) return null;
  await env.DB.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(cacheKey, created.id).run();
  return created.id;
}
__name(findOrCreateBoardEn, "findOrCreateBoardEn");
async function generateHebrewTitle(imageUrl, category, env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 30,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "url", url: imageUrl } },
            { type: "text", text: `\u05D6\u05D5\u05D4\u05D9 \u05EA\u05DE\u05D5\u05E0\u05D4 \u05DE\u05D2\u05DC\u05E8\u05D9\u05D9\u05EA \u05D4\u05E6\u05D9\u05DC\u05D5\u05DD \u05E9\u05DC \u05D4\u05E6\u05DC\u05DD \u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6, \u05E7\u05D8\u05D2\u05D5\u05E8\u05D9\u05D4: ${category || "\u05DB\u05DC\u05DC\u05D9"}.
\u05EA\u05DF \u05DC\u05EA\u05DE\u05D5\u05E0\u05D4 \u05DB\u05D5\u05EA\u05E8\u05EA \u05E7\u05E6\u05E8\u05D4 \u05D5\u05D9\u05E4\u05D4 \u05D1\u05E2\u05D1\u05E8\u05D9\u05EA \u2014 2 \u05E2\u05D3 4 \u05DE\u05D9\u05DC\u05D9\u05DD \u05D1\u05DC\u05D1\u05D3.
\u05D7\u05D5\u05D1\u05D4: \u05D4\u05E9\u05EA\u05DE\u05E9 \u05D1\u05D0\u05D5\u05EA\u05D9\u05D5\u05EA \u05E2\u05D1\u05E8\u05D9\u05D5\u05EA \u05D1\u05DC\u05D1\u05D3 (Unicode U+05D0\u2013U+05EA \u05D5\u05E8\u05D5\u05D5\u05D7\u05D9\u05DD). \u05D0\u05E1\u05D5\u05E8 \u05D1\u05EA\u05DB\u05DC\u05D9\u05EA \u05D4\u05D0\u05D9\u05E1\u05D5\u05E8 \u05DC\u05D4\u05E9\u05EA\u05DE\u05E9 \u05D1\u05E2\u05E8\u05D1\u05D9\u05EA, \u05E1\u05D9\u05E0\u05D9\u05EA, \u05D0\u05E0\u05D2\u05DC\u05D9\u05EA \u05D0\u05D5 \u05DB\u05DC \u05E9\u05E4\u05D4 \u05D0\u05D7\u05E8\u05EA.
\u05D4\u05D7\u05D6\u05E8 \u05E8\u05E7 \u05D0\u05EA \u05D4\u05DB\u05D5\u05EA\u05E8\u05EA, \u05DC\u05DC\u05D0 \u05E4\u05D9\u05E1\u05D5\u05E7 \u05E0\u05D5\u05E1\u05E3.` }
          ]
        }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data.content?.[0]?.text?.replace(/[\*_`#\n\r]/g, "").trim().replace(/^['"]|['"]$/g, "") || null;
    if (raw && /[^\u05D0-\u05EA\u05F0-\u05F4 ,.\-–—'״׳]/.test(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}
__name(generateHebrewTitle, "generateHebrewTitle");
async function handleGenerateAlt(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: "ANTHROPIC_API_KEY \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8" }, 500, request);
  const { urls } = await request.json().catch(() => ({}));
  if (!Array.isArray(urls) || !urls.length) return jsonRes({ error: "urls \u05D7\u05E1\u05E8" }, 400, request);
  const results = [];
  for (const { id, url, category } of urls) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 60,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "url", url } },
              { type: "text", text: `\u05D6\u05D5\u05D4\u05D9 \u05EA\u05DE\u05D5\u05E0\u05D4 \u05DE\u05D2\u05DC\u05E8\u05D9\u05D9\u05EA \u05D4\u05E6\u05D9\u05DC\u05D5\u05DD \u05E9\u05DC \u05D4\u05E6\u05DC\u05DD \u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6, \u05E7\u05D8\u05D2\u05D5\u05E8\u05D9\u05D4: ${category || "\u05DB\u05DC\u05DC\u05D9"}.
\u05DB\u05EA\u05D5\u05D1 alt text \u05E7\u05E6\u05E8 \u05D5\u05EA\u05D9\u05D0\u05D5\u05E8\u05D9 \u05D1\u05E2\u05D1\u05E8\u05D9\u05EA \u2014 \u05DE\u05E9\u05E4\u05D8 \u05D0\u05D7\u05D3, \u05E2\u05D3 10 \u05DE\u05D9\u05DC\u05D9\u05DD.
\u05D4\u05D7\u05D6\u05E8 \u05E8\u05E7 \u05D0\u05EA \u05D4\u05D8\u05E7\u05E1\u05D8, \u05DC\u05DC\u05D0 \u05E4\u05D9\u05E1\u05D5\u05E7 \u05E0\u05D5\u05E1\u05E3.` }
            ]
          }]
        })
      });
      if (res.ok) {
        const data = await res.json();
        const alt = data.content?.[0]?.text?.replace(/[\*_`#\n\r]/g, "").trim() || null;
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
__name(handleGenerateAlt, "handleGenerateAlt");
async function handleFillTitles(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405);
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: "ANTHROPIC_API_KEY \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8" }, 500);
  const origin = new URL(request.url).origin;
  const { results: photos } = await env.DB.prepare(
    "SELECT id, title, category, r2_key FROM photos"
  ).all();
  const toFill = photos.filter((p) => isGenericTitle(p.title));
  if (!toFill.length) return jsonRes({ updated: 0, message: "\u05DB\u05DC \u05D4\u05DB\u05D5\u05EA\u05E8\u05D5\u05EA \u05DB\u05D1\u05E8 \u05DE\u05DC\u05D0\u05D5\u05EA" });
  const updated = [];
  for (const photo of toFill) {
    try {
      const imageUrl = `${origin}/photos/${photo.r2_key}`;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 30,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "url", url: imageUrl } },
              { type: "text", text: `\u05D6\u05D5\u05D4\u05D9 \u05EA\u05DE\u05D5\u05E0\u05D4 \u05DE\u05D2\u05DC\u05E8\u05D9\u05D9\u05EA \u05D4\u05E6\u05D9\u05DC\u05D5\u05DD \u05E9\u05DC \u05D4\u05E6\u05DC\u05DD \u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6, \u05E7\u05D8\u05D2\u05D5\u05E8\u05D9\u05D4: ${photo.category || "\u05DB\u05DC\u05DC\u05D9"}.
\u05EA\u05DF \u05DC\u05EA\u05DE\u05D5\u05E0\u05D4 \u05DB\u05D5\u05EA\u05E8\u05EA \u05E7\u05E6\u05E8\u05D4 \u05D5\u05D9\u05E4\u05D4 \u05D1\u05E2\u05D1\u05E8\u05D9\u05EA \u2014 2 \u05E2\u05D3 4 \u05DE\u05D9\u05DC\u05D9\u05DD \u05D1\u05DC\u05D1\u05D3.
\u05D4\u05D7\u05D6\u05E8 \u05E8\u05E7 \u05D0\u05EA \u05D4\u05DB\u05D5\u05EA\u05E8\u05EA, \u05DC\u05DC\u05D0 \u05E4\u05D9\u05E1\u05D5\u05E7 \u05E0\u05D5\u05E1\u05E3.` }
            ]
          }]
        })
      });
      if (!res.ok) continue;
      const data = await res.json();
      const title = data.content?.[0]?.text?.replace(/[\*_`#\n\r]/g, "").trim().replace(/^['"]|['"]$/g, "");
      if (title) {
        await env.DB.prepare("UPDATE photos SET title=? WHERE id=?").bind(title, photo.id).run();
        updated.push({ id: photo.id, title });
      }
    } catch {
    }
  }
  return jsonRes({ updated: updated.length, total: toFill.length, titles: updated });
}
__name(handleFillTitles, "handleFillTitles");
async function handleDownload(request, env, token) {
  if (!token) return jsonRes({ error: "token \u05D7\u05E1\u05E8" }, 400, request);
  const row = await env.DB.prepare(
    "SELECT * FROM download_tokens WHERE token = ?"
  ).bind(token).first();
  if (!row) return jsonRes({ error: "\u05E7\u05D9\u05E9\u05D5\u05E8 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF" }, 404, request);
  if (row.used) return jsonRes({ error: "\u05E7\u05D9\u05E9\u05D5\u05E8 \u05D6\u05D4 \u05DB\u05D1\u05E8 \u05E9\u05D5\u05DE\u05E9" }, 410, request);
  if (Math.floor(Date.now() / 1e3) > row.expires_at) return jsonRes({ error: "\u05E4\u05D2 \u05EA\u05D5\u05E7\u05E3 \u05D4\u05E7\u05D9\u05E9\u05D5\u05E8" }, 410, request);
  await env.DB.prepare("UPDATE download_tokens SET used = 1 WHERE token = ?").bind(token).run();
  const photoIds = JSON.parse(row.photo_ids);
  const photoId = photoIds[0];
  const photo = await env.DB.prepare("SELECT r2_key, title FROM photos WHERE id = ?").bind(photoId).first();
  if (photo?.r2_key) {
    const object = await env.PHOTOS.get(photo.r2_key);
    if (!object) return jsonRes({ error: "\u05E7\u05D5\u05D1\u05E5 \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0 \u05D1-R2" }, 404, request);
    const filename = (photo.title || "photo").replace(/[^\w\u0590-\u05ff .-]/g, "_") + ".jpg";
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType || "image/jpeg",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store"
      }
    });
  }
  const SZ_MAP = { small: "w1500", medium: "w3000", large: null };
  const sz = SZ_MAP[row.size];
  const driveUrl = sz ? `https://lh3.googleusercontent.com/d/${photoId}=${sz}` : `https://drive.google.com/uc?export=download&id=${photoId}`;
  return Response.redirect(driveUrl, 302);
}
__name(handleDownload, "handleDownload");
async function sendPurchaseEmail(env, { titles, size, amount, txnId, tokens, origin }) {
  if (!env.RESEND_API_KEY) return;
  const adminEmail = env.ADMIN_EMAIL || "contact@amitphotos.com";
  const fromEmail = "Amit Photos <onboarding@resend.dev>";
  const sizeLabel = { small: "\u05E7\u05D5\u05D1\u05E5 \u05E8\u05E9\u05EA", medium: "\u05E7\u05D5\u05D1\u05E5 \u05D4\u05D3\u05E4\u05E1\u05D4", large: "\u05E7\u05D5\u05D1\u05E5 \u05DE\u05DC\u05D0" }[size] || size;
  const tokenLinks = tokens.map((t) => `<a href="${origin}/api/download/${t}">${origin}/api/download/${t}</a>`).join("<br>");
  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;padding:24px">
      <h2>\u{1F4F8} \u05E8\u05DB\u05D9\u05E9\u05D4 \u05D7\u05D3\u05E9\u05D4 \u05D1-Amit Photos!</h2>
      <p><strong>\u05EA\u05DE\u05D5\u05E0\u05D5\u05EA:</strong> ${titles.join(", ")}</p>
      <p><strong>\u05D2\u05D5\u05D3\u05DC:</strong> ${sizeLabel}</p>
      <p><strong>\u05E1\u05DB\u05D5\u05DD:</strong> \u20AA${amount}</p>
      <p><strong>Transaction:</strong> ${txnId}</p>
      <p><strong>\u05E7\u05D9\u05E9\u05D5\u05E8\u05D9 \u05D4\u05D5\u05E8\u05D3\u05D4:</strong><br>${tokenLinks}</p>
    </div>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromEmail, to: adminEmail, subject: `\u05E8\u05DB\u05D9\u05E9\u05D4 \u05D7\u05D3\u05E9\u05D4 \u{1F4F8} \u2014 ${titles[0]} (${sizeLabel})`, html })
  }).catch(() => {
  });
}
__name(sendPurchaseEmail, "sendPurchaseEmail");
async function sendPurchaseTelegram(env, { titles, size, amount, txnId }) {
  if (!env.CALLMEBOT_TELEGRAM_USER) return;
  const sizeLabel = { small: "\u05E8\u05E9\u05EA", medium: "\u05D4\u05D3\u05E4\u05E1\u05D4", large: "\u05DE\u05DC\u05D0" }[size] || size;
  const msg = `\u05E8\u05DB\u05D9\u05E9\u05D4 \u05D7\u05D3\u05E9\u05D4! \u{1F4F8} ${titles.join(", ")} | ${sizeLabel} | \u20AA${amount} | ${txnId}`;
  const url = `https://api.callmebot.com/text.php?user=@${env.CALLMEBOT_TELEGRAM_USER}&text=${encodeURIComponent(msg)}`;
  await fetch(url).catch(() => {
  });
}
__name(sendPurchaseTelegram, "sendPurchaseTelegram");
async function handleVerifyPayment(request, env, ctx) {
  if (request.method !== "GET") return jsonRes({ error: "method not allowed" }, 405, request);
  const url = new URL(request.url);
  const params = url.searchParams;
  const txnId = params.get("txn_id") || params.get("tx");
  const itemNumber = params.get("item_number");
  const paymentStatus = params.get("payment_status");
  const mcCurrency = params.get("mc_currency");
  if (!txnId) return jsonRes({ error: "\u05D7\u05E1\u05E8 transaction ID" }, 400, request);
  if (!itemNumber) return jsonRes({ error: "item_number \u05D7\u05E1\u05E8" }, 400, request);
  const receiverId = params.get("receiver_id");
  const PAYPAL_RECEIVER_ID = env.PAYPAL_RECEIVER_ID;
  if (paymentStatus !== "Completed") return jsonRes({ error: `\u05E1\u05D8\u05D8\u05D5\u05E1 \u05EA\u05E9\u05DC\u05D5\u05DD: ${paymentStatus || "\u05D7\u05E1\u05E8"}` }, 402, request);
  if (receiverId !== PAYPAL_RECEIVER_ID) return jsonRes({ error: "\u05D7\u05E9\u05D1\u05D5\u05DF PayPal \u05DC\u05D0 \u05EA\u05D5\u05D0\u05DD" }, 402, request);
  if (mcCurrency !== "ILS") return jsonRes({ error: "\u05DE\u05D8\u05D1\u05E2 \u05DC\u05D0 \u05EA\u05D5\u05D0\u05DD" }, 402, request);
  let photoIds, size;
  if (itemNumber.startsWith("CART_")) {
    const rest = itemNumber.slice(5);
    const firstUnderscore = rest.indexOf("_");
    if (firstUnderscore === -1) return jsonRes({ error: "item_number \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF" }, 400, request);
    size = rest.substring(0, firstUnderscore);
    photoIds = rest.substring(firstUnderscore + 1).split(",").filter(Boolean);
  } else {
    const lastUnderscore = itemNumber.lastIndexOf("_");
    if (lastUnderscore === -1) return jsonRes({ error: "item_number \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF" }, 400, request);
    photoIds = [itemNumber.substring(0, lastUnderscore)];
    size = itemNumber.substring(lastUnderscore + 1);
  }
  const VALID_SIZES = ["small", "medium", "large"];
  if (!VALID_SIZES.includes(size)) return jsonRes({ error: "\u05D2\u05D5\u05D3\u05DC \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF" }, 400, request);
  const PRICES = await getGlobalPrices(env);
  const BUNDLE_MIN = 3;
  const BUNDLE_DISCOUNT = 0.1;
  const mcGross = parseFloat(params.get("mc_gross") || 0);
  let unitPrice = PRICES[size];
  if (photoIds.length === 1) {
    const photoRow = await env.DB.prepare("SELECT price_overrides FROM photos WHERE id = ?").bind(photoIds[0]).first();
    if (photoRow?.price_overrides) {
      try {
        const ov = JSON.parse(photoRow.price_overrides);
        if (ov[size] != null) unitPrice = ov[size];
      } catch {
      }
    }
  }
  const subtotal = photoIds.length * unitPrice;
  const discount = photoIds.length >= BUNDLE_MIN ? Math.round(subtotal * BUNDLE_DISCOUNT) : 0;
  const expectedPrice = subtotal - discount;
  if (mcGross < expectedPrice) {
    return jsonRes({ error: `\u05E1\u05DB\u05D5\u05DD \u05E9\u05E9\u05D5\u05DC\u05DD (${mcGross}\u20AA) \u05E0\u05DE\u05D5\u05DA \u05DE\u05D4\u05DE\u05D7\u05D9\u05E8 (${expectedPrice}\u20AA)` }, 402, request);
  }
  if (!txnId) return jsonRes({ error: "txn_id \u05D7\u05E1\u05E8" }, 402, request);
  const existing = await env.DB.prepare("SELECT token FROM download_tokens WHERE tx = ? LIMIT 1").bind(txnId).first();
  if (existing) return jsonRes({ error: "\u05E2\u05E1\u05E7\u05D4 \u05D6\u05D5 \u05DB\u05D1\u05E8 \u05E2\u05D5\u05D1\u05D3\u05D4" }, 409, request);
  const now = Math.floor(Date.now() / 1e3);
  const expires = now + 86400;
  const tokens = [];
  for (const photoId of photoIds) {
    const token = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at, amount) VALUES (?, ?, ?, ?, 0, ?, ?, ?)"
    ).bind(token, JSON.stringify([photoId]), size, txnId, expires, now, mcGross / photoIds.length).run();
    tokens.push(token);
  }
  const notifTitles = await Promise.all(photoIds.map(async (id) => {
    const r = await env.DB.prepare("SELECT title FROM photos WHERE id = ?").bind(id).first();
    return r?.title || id;
  }));
  const origin = new URL(request.url).origin;
  ctx.waitUntil(sendPurchaseEmail(env, { titles: notifTitles, size, amount: mcGross, txnId, tokens, origin }));
  ctx.waitUntil(sendPurchaseTelegram(env, { titles: notifTitles, size, amount: mcGross, txnId }));
  if (tokens.length === 1) {
    return jsonRes({ url: `/api/download/${tokens[0]}`, title: notifTitles[0] }, 200, request);
  }
  const urlItems = photoIds.map((photoId, i) => ({ url: `/api/download/${tokens[i]}`, title: notifTitles[i] }));
  return jsonRes({ urls: urlItems, title: params.get("item_name") || "\u05D7\u05D1\u05D9\u05DC\u05EA \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA" }, 200, request);
}
__name(handleVerifyPayment, "handleVerifyPayment");
var GELATO_API = "https://order.gelatoapis.com/v4";
var PRINT_CATALOG = {
  poster: {
    label: "\u05E4\u05D5\u05E1\u05D8\u05E8 \u2014 \u05E0\u05D9\u05D9\u05E8 \u05D0\u05DE\u05E0\u05D5\u05EA \u05DE\u05D8",
    desc: "\u05E0\u05D9\u05D9\u05E8 \u05D0\u05DE\u05E0\u05D5\u05EA 170gsm, \u05E4\u05D9\u05E0\u05D9\u05E9\u05D9\u05E0\u05D2 \u05DE\u05D8 \u2014 \u05DB\u05D5\u05DC\u05DC \u05DE\u05E9\u05DC\u05D5\u05D7 \u05DC\u05D9\u05E9\u05E8\u05D0\u05DC",
    sizes: [
      { label: '20\xD725 \u05E1"\u05DE (8\xD710")', sku: "flat_200x250-mm-8x10-inch_170-gsm-65lb-uncoated_4-0_ver", minW: 2400, minH: 3e3 },
      { label: '30\xD740 \u05E1"\u05DE (12\xD716")', sku: "flat_300x400-mm-12x16-inch_170-gsm-65lb-uncoated_4-0_ver", minW: 3543, minH: 4724 },
      { label: '40\xD750 \u05E1"\u05DE (16\xD720")', sku: "flat_400x500-mm-16x20-inch_170-gsm-65lb-uncoated_4-0_ver", minW: 4724, minH: 5906 },
      { label: 'A3 \u2014 30\xD742 \u05E1"\u05DE', sku: "flat_a3_170-gsm-65lb-uncoated_4-0_ver", minW: 3508, minH: 4961 },
      { label: 'A2 \u2014 42\xD759 \u05E1"\u05DE', sku: "flat_a2_170-gsm-65lb-uncoated_4-0_ver", minW: 4961, minH: 7016 },
      { label: '45\xD760 \u05E1"\u05DE (18\xD724")', sku: "flat_450x600-mm-18x24-inch_170-gsm-65lb-uncoated_4-0_ver", minW: 5315, minH: 7087 },
      { label: '60\xD790 \u05E1"\u05DE (24\xD736")', sku: "flat_600x900-mm-24x36-inch_170-gsm-65lb-uncoated_4-0_ver", minW: 7087, minH: 10630 }
    ]
  },
  canvas: {
    label: "\u05D4\u05D3\u05E4\u05E1\u05D4 \u05E2\u05DC \u05E7\u05E0\u05D1\u05E1",
    desc: "\u05E7\u05E0\u05D1\u05E1 \u05DE\u05EA\u05D5\u05D7 \u05E2\u05DC \u05DE\u05E1\u05D2\u05E8\u05EA \u05E2\u05E5, \u05DE\u05D5\u05DB\u05DF \u05DC\u05EA\u05DC\u05D9\u05D9\u05D4 \u2014 \u05DB\u05D5\u05DC\u05DC \u05DE\u05E9\u05DC\u05D5\u05D7 \u05DC\u05D9\u05E9\u05E8\u05D0\u05DC",
    sizes: [
      { label: '20\xD720 \u05E1"\u05DE', sku: "canvas_200x200-mm-8x8-inch_canvas_wood-fsc-slim_4-0_ver", minW: 2362, minH: 2362 },
      { label: '20\xD725 \u05E1"\u05DE', sku: "canvas_200x250-mm-8x10-inch_canvas_wood-fsc-slim_4-0_ver", minW: 2362, minH: 2953 },
      { label: '30\xD740 \u05E1"\u05DE', sku: "canvas_12x16-inch-300x400-mm_canvas_wood-fsc-slim_4-0_ver", minW: 3543, minH: 4724 },
      { label: '40\xD750 \u05E1"\u05DE', sku: "canvas_16x20-inch-400x500-mm_canvas_wood-fsc-slim_4-0_ver", minW: 4724, minH: 5906 },
      { label: '45\xD760 \u05E1"\u05DE', sku: "canvas_18x24-inch-450x600-mm_canvas_wood-fsc-slim_4-0_ver", minW: 5315, minH: 7087 }
    ]
  },
  metallic: {
    label: "\u05D4\u05D3\u05E4\u05E1\u05D4 \u05E2\u05DC \u05DE\u05EA\u05DB\u05EA",
    desc: "\u05D4\u05D3\u05E4\u05E1\u05D4 \u05E2\u05DC \u05D0\u05DC\u05D5\u05DE\u05D9\u05E0\u05D9\u05D5\u05DD 3mm \u2014 \u05D2\u05D9\u05DE\u05D5\u05E8 \u05DE\u05D1\u05E8\u05D9\u05E7 \u05D9\u05D5\u05E7\u05E8\u05EA\u05D9, \u05DE\u05D5\u05DB\u05DF \u05DC\u05EA\u05DC\u05D9\u05D9\u05D4 \u2014 \u05DB\u05D5\u05DC\u05DC \u05DE\u05E9\u05DC\u05D5\u05D7 \u05DC\u05D9\u05E9\u05E8\u05D0\u05DC",
    sizes: [
      { label: '30\xD730 \u05E1"\u05DE (12\xD712")', sku: "metallic_12x12-inch-300x300-mm_3-mm_4-0_ver", minW: 3543, minH: 3543 },
      { label: '30\xD740 \u05E1"\u05DE (12\xD716")', sku: "metallic_12x16-inch-300x400-mm_3-mm_4-0_ver", minW: 3543, minH: 4724 },
      { label: '30\xD745 \u05E1"\u05DE (12\xD718")', sku: "metallic_12x18-inch-300x450-mm_3-mm_4-0_ver", minW: 3543, minH: 5315 }
    ]
  }
};
async function handlePrintCatalog(request, env) {
  return jsonRes(PRINT_CATALOG, 200, request);
}
__name(handlePrintCatalog, "handlePrintCatalog");
async function handlePrintQuote(request, env) {
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  const { sku } = await request.json().catch(() => ({}));
  if (!sku) return jsonRes({ error: "sku \u05D7\u05E1\u05E8" }, 400, request);
  if (!env.GELATO_API_KEY) return jsonRes({ error: "GELATO_API_KEY \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8" }, 500, request);
  const res = await fetch(`${GELATO_API}/orders:quote`, {
    method: "POST",
    headers: { "X-API-KEY": env.GELATO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      orderType: "order",
      orderReferenceId: `quote-${Date.now()}`,
      customerReferenceId: "quote",
      currency: "USD",
      recipient: { country: "IL" },
      products: [{ itemReferenceId: "item-1", productUid: sku, quantity: 1 }]
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return jsonRes({ error: err.message || `\u05E9\u05D2\u05D9\u05D0\u05EA Gelato: ${res.status}` }, 500, request);
  }
  const data = await res.json();
  const quote = data.quotes?.[0];
  if (!quote) return jsonRes({ error: "\u05DC\u05D0 \u05D4\u05EA\u05E7\u05D1\u05DC\u05D4 \u05D4\u05E6\u05E2\u05EA \u05DE\u05D7\u05D9\u05E8" }, 500, request);
  const productCost = parseFloat(quote.products?.[0]?.price || 0);
  const methods = quote.shipmentMethods || [];
  const cheapestMethod = methods.length ? methods.reduce((a, b) => a.price < b.price ? a : b) : null;
  const shippingCost = parseFloat(cheapestMethod?.price || 0);
  const totalCost = productCost + shippingCost;
  const sellPrice = Math.ceil(totalCost * 1.6 / 5) * 5;
  return jsonRes({ sellPrice, sku }, 200, request);
}
__name(handlePrintQuote, "handlePrintQuote");
async function handlePrintOrderComplete(request, env) {
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  const { tx, itemNumber, allParams } = await request.json().catch(() => ({}));
  if (!tx || !itemNumber) return jsonRes({ error: "\u05D7\u05E1\u05E8\u05D9\u05DD \u05E4\u05E8\u05DE\u05D8\u05E8\u05D9\u05DD" }, 400, request);
  if (!itemNumber.startsWith("PRINT_")) return jsonRes({ error: "item_number \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF" }, 400, request);
  const rest = itemNumber.slice(6);
  const firstUnderscore = rest.indexOf("_");
  if (firstUnderscore === -1) return jsonRes({ error: "item_number \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF" }, 400, request);
  const photoId = rest.substring(0, firstUnderscore);
  const sku = rest.substring(firstUnderscore + 1);
  const urlParams = new URLSearchParams(allParams || "");
  const paymentStatus = urlParams.get("payment_status");
  const receiverId = urlParams.get("receiver_id");
  const mcCurrency = urlParams.get("mc_currency");
  const PAYPAL_RECEIVER_ID = env.PAYPAL_RECEIVER_ID;
  if (paymentStatus !== "Completed") return jsonRes({ error: `\u05E1\u05D8\u05D8\u05D5\u05E1 \u05EA\u05E9\u05DC\u05D5\u05DD: ${paymentStatus || "\u05D7\u05E1\u05E8"}` }, 402, request);
  if (receiverId !== PAYPAL_RECEIVER_ID) return jsonRes({ error: "\u05D7\u05E9\u05D1\u05D5\u05DF PayPal \u05DC\u05D0 \u05EA\u05D5\u05D0\u05DD" }, 402, request);
  if (mcCurrency !== "USD") return jsonRes({ error: "\u05DE\u05D8\u05D1\u05E2 \u05DC\u05D0 \u05EA\u05D5\u05D0\u05DD" }, 402, request);
  const existingOrder = await env.DB.prepare("SELECT id FROM print_orders WHERE paypal_tx = ? LIMIT 1").bind(tx).first();
  if (existingOrder) return jsonRes({ orderId: existingOrder.id }, 200, request);
  let address;
  try {
    const customRaw = (urlParams.get("custom") || "").replace(/ /g, "+");
    address = JSON.parse(atob(customRaw));
  } catch {
    return jsonRes({ error: "\u05E0\u05EA\u05D5\u05E0\u05D9 \u05DB\u05EA\u05D5\u05D1\u05EA \u05D7\u05E1\u05E8\u05D9\u05DD" }, 400, request);
  }
  const origin = new URL(request.url).origin;
  const photo = await env.DB.prepare("SELECT url FROM photos WHERE id=?").bind(photoId).first();
  if (!photo) return jsonRes({ error: "\u05EA\u05DE\u05D5\u05E0\u05D4 \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D4" }, 404, request);
  const originalUrl = photo.url.startsWith("http") ? photo.url : `${origin}${photo.url}`;
  const photoUrl = address.cropUrl || originalUrl;
  const typeEntry = Object.values(PRINT_CATALOG).find((t) => t.sizes.some((s) => s.sku === sku));
  const sizeEntry = typeEntry?.sizes.find((s) => s.sku === sku);
  const orderId = crypto.randomUUID();
  const gelatoRes = await fetch(`${GELATO_API}/orders`, {
    method: "POST",
    headers: { "X-API-KEY": env.GELATO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      orderType: "order",
      orderReferenceId: orderId,
      customerReferenceId: orderId,
      currency: "USD",
      shippingAddress: (() => {
        const parts = (address.name || "").trim().split(/\s+/);
        const firstName = parts[0] || "\u05DC\u05E7\u05D5\u05D7";
        const lastName = parts.slice(1).join(" ") || "-";
        return {
          firstName,
          lastName,
          email: address.email || "",
          phone: address.phone || "",
          addressLine1: address.line1,
          city: address.city,
          postCode: address.zip,
          country: "IL"
        };
      })(),
      items: [{
        itemReferenceId: `item-${orderId}`,
        productUid: sku,
        quantity: 1,
        files: [{ type: "default", url: photoUrl }]
      }]
    })
  });
  if (!gelatoRes.ok) {
    const err = await gelatoRes.json().catch(() => ({}));
    return jsonRes({ error: `\u05E9\u05D2\u05D9\u05D0\u05EA Gelato: ${err.message || gelatoRes.status}` }, 500, request);
  }
  const pd = await gelatoRes.json();
  const gelatoOrderId = pd.id || "";
  const productLabel = typeEntry && sizeEntry ? `${typeEntry.label} \u2014 ${sizeEntry.label}` : sku;
  const sellPrice = parseFloat(urlParams.get("mc_gross") || 0);
  await env.DB.prepare(
    `INSERT INTO print_orders (id, prodigi_order_id, photo_id, sku, product_label, sell_price, customer_name, customer_email, customer_phone, address_line1, address_city, address_zip, paypal_tx, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_production', ?)`
  ).bind(
    orderId,
    gelatoOrderId,
    photoId,
    sku,
    productLabel,
    sellPrice,
    address.name,
    address.email || "",
    address.phone || "",
    address.line1,
    address.city,
    address.zip,
    tx,
    (/* @__PURE__ */ new Date()).toISOString()
  ).run();
  if (address.email && env.RESEND_API_KEY) {
    const fromEmail = env.FROM_EMAIL || "amit@amitphotos.com";
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
          <h2 style="margin:0 0 1rem;font-size:18px">\u05E9\u05DC\u05D5\u05DD ${address.name}, \u05D4\u05D4\u05D6\u05DE\u05E0\u05D4 \u05D4\u05EA\u05E7\u05D1\u05DC\u05D4!</h2>
          <p><strong>\u05DE\u05D5\u05E6\u05E8:</strong> ${productLabel}</p>
          <p><strong>\u05DB\u05EA\u05D5\u05D1\u05EA:</strong> ${address.line1}, ${address.city} ${address.zip}</p>
          <p><strong>\u05DE\u05D7\u05D9\u05E8 \u05E9\u05E9\u05D5\u05DC\u05DD:</strong> $${sellPrice}</p>
          <p style="color:#888;font-size:.9rem">\u05D6\u05DE\u05DF \u05DE\u05E9\u05DC\u05D5\u05D7 \u05DE\u05E9\u05D5\u05E2\u05E8: 7\u201310 \u05D9\u05DE\u05D9 \u05E2\u05E1\u05E7\u05D9\u05DD.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:1.5rem 0">
          <p style="color:#555;font-size:.88rem">\u05E8\u05D5\u05E6\u05D4 \u05DC\u05D1\u05D8\u05DC? \u05E0\u05D9\u05EA\u05DF \u05DC\u05D1\u05D8\u05DC \u05EA\u05D5\u05DA \u05E9\u05E2\u05D4 \u05DE\u05E8\u05D2\u05E2 \u05D4\u05D4\u05D6\u05DE\u05E0\u05D4:</p>
          <p style="text-align:center;margin:1rem 0">
            <a href="${cancelUrl}" style="background:#c8a96e;color:#0a0a0a;padding:.7rem 2rem;border-radius:6px;text-decoration:none;font-weight:700;font-size:.95rem">\u05D1\u05D9\u05D8\u05D5\u05DC \u05D4\u05D6\u05DE\u05E0\u05D4</a>
          </p>
          <p style="color:#aaa;font-size:.78rem;text-align:center">\u05D4\u05DB\u05E4\u05EA\u05D5\u05E8 \u05D9\u05E4\u05E1\u05D9\u05E7 \u05DC\u05E2\u05D1\u05D5\u05D3 \u05DC\u05D0\u05D7\u05E8 \u05E9\u05E2\u05D4</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromEmail, to: address.email, subject: "\u05D0\u05D9\u05E9\u05D5\u05E8 \u05D4\u05D6\u05DE\u05E0\u05EA \u05D4\u05D3\u05E4\u05E1\u05D4 \u2014 Amit Photos", html: confirmHtml })
    });
    const adminEmail = env.ADMIN_EMAIL || "contact@amitphotos.com";
    const adminHtml = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:32px;background:#f4f4f4;font-family:Arial,sans-serif">
  <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:8px;padding:2rem;border:1px solid #ddd">
    <div style="color:#c8a96e;font-size:1rem;font-weight:700;letter-spacing:.2em;margin-bottom:1.5rem">AMIT PHOTOS \u2014 \u05D4\u05D6\u05DE\u05E0\u05D4 \u05D7\u05D3\u05E9\u05D4 \u{1F5A8}\uFE0F</div>
    <table style="width:100%;border-collapse:collapse;font-size:.92rem;direction:rtl">
      <tr><td style="padding:.4rem 0;color:#888;width:35%">\u05DC\u05E7\u05D5\u05D7</td><td><strong>${address.name}</strong></td></tr>
      <tr><td style="padding:.4rem 0;color:#888">\u05D8\u05DC\u05E4\u05D5\u05DF</td><td><a href="tel:${address.phone}" style="color:#c8a96e">${address.phone || "\u2014"}</a></td></tr>
      <tr><td style="padding:.4rem 0;color:#888">\u05DE\u05D9\u05D9\u05DC</td><td><a href="mailto:${address.email}" style="color:#c8a96e">${address.email}</a></td></tr>
      <tr><td style="padding:.4rem 0;color:#888">\u05DB\u05EA\u05D5\u05D1\u05EA</td><td>${address.line1}, ${address.city} ${address.zip}</td></tr>
      <tr><td style="padding:.4rem 0;color:#888">\u05DE\u05D5\u05E6\u05E8</td><td>${productLabel}</td></tr>
      <tr><td style="padding:.4rem 0;color:#888">\u05DE\u05D7\u05D9\u05E8</td><td><strong>$${sellPrice}</strong></td></tr>
      <tr><td style="padding:.4rem 0;color:#888">Gelato ID</td><td style="font-size:.82rem;color:#aaa">${gelatoOrderId || "\u2014"}</td></tr>
    </table>
  </div>
</body></html>`;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromEmail, to: adminEmail, subject: `\u05D4\u05D6\u05DE\u05E0\u05EA \u05D4\u05D3\u05E4\u05E1\u05D4 \u05D7\u05D3\u05E9\u05D4 \u2014 ${address.name} ($${sellPrice})`, html: adminHtml })
    });
  }
  return jsonRes({ ok: true, orderId: gelatoOrderId || orderId }, 200, request);
}
__name(handlePrintOrderComplete, "handlePrintOrderComplete");
async function handlePrintCancel(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) return new Response("\u05E7\u05D9\u05E9\u05D5\u05E8 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF", { status: 400 });
  const order = await env.DB.prepare("SELECT * FROM print_orders WHERE id=?").bind(token).first();
  if (!order) return htmlRes(cancelPage("\u05D4\u05D6\u05DE\u05E0\u05D4 \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D4", false), 404);
  if (order.status === "cancelled") {
    return htmlRes(cancelPage("\u05D4\u05D4\u05D6\u05DE\u05E0\u05D4 \u05DB\u05D1\u05E8 \u05D1\u05D5\u05D8\u05DC\u05D4", false));
  }
  const created = new Date(order.created_at);
  const diffMin = (Date.now() - created.getTime()) / 6e4;
  if (diffMin > 60) {
    return htmlRes(cancelPage("\u05E4\u05D2 \u05EA\u05D5\u05E7\u05E3 \u05D4\u05D1\u05D9\u05D8\u05D5\u05DC (\u05E9\u05E2\u05D4 \u05D0\u05D7\u05E8\u05D9 \u05D4\u05D4\u05D6\u05DE\u05E0\u05D4)", false));
  }
  if (order.prodigi_order_id) {
    await fetch("https://api.gelato.com/v2/order/cancel", {
      method: "POST",
      headers: { "X-API-KEY": env.GELATO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ orderReferenceId: order.prodigi_order_id })
    }).catch(() => {
    });
  }
  await env.DB.prepare("UPDATE print_orders SET status=? WHERE id=?").bind("cancelled", token).run();
  return htmlRes(cancelPage("\u05D4\u05D4\u05D6\u05DE\u05E0\u05D4 \u05D1\u05D5\u05D8\u05DC\u05D4 \u05D1\u05D4\u05E6\u05DC\u05D7\u05D4", true));
}
__name(handlePrintCancel, "handlePrintCancel");
function cancelPage(message, success) {
  const color = success ? "#4caf7d" : "#e55";
  const icon = success ? "\u2705" : "\u274C";
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${message} \u2014 Amit Photos</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;background:#0a0a0a;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}.card{background:#141414;border:1px solid #222;border-radius:12px;padding:3rem 2.5rem;max-width:440px;width:100%;text-align:center}.logo{color:#c8a96e;font-size:1rem;letter-spacing:.25em;margin-bottom:2rem}.icon{font-size:3rem;margin-bottom:1rem}h1{font-size:1.3rem;margin-bottom:.75rem;color:${color}}p{color:#888;font-size:.9rem;line-height:1.7;margin-bottom:1rem}.btn{display:inline-block;margin-top:1.5rem;padding:.7rem 1.8rem;background:#c8a96e;color:#0a0a0a;border-radius:6px;text-decoration:none;font-weight:700;font-size:.9rem}</style>
</head>
<body>
  <div class="card">
    <div class="logo">AMIT PHOTOS</div>
    <div class="icon">${icon}</div>
    <h1>${message}</h1>
    ${success ? "<p>\u05D4\u05D4\u05D7\u05D6\u05E8 \u05D4\u05DB\u05E1\u05E4\u05D9 \u05D9\u05D1\u05D5\u05E6\u05E2 \u05D3\u05E8\u05DA PayPal \u05EA\u05D5\u05DA 3\u20135 \u05D9\u05DE\u05D9 \u05E2\u05E1\u05E7\u05D9\u05DD.</p>" : '<p>\u05DC\u05E2\u05D6\u05E8\u05D4 \u05E0\u05D5\u05E1\u05E4\u05EA \u05E6\u05E8\u05D5 \u05E7\u05E9\u05E8: <a href="mailto:contact@amitphotos.com" style="color:#c8a96e">contact@amitphotos.com</a></p>'}
    <a href="https://amitphotos.com" class="btn">\u05D7\u05D6\u05E8\u05D4 \u05DC\u05D0\u05EA\u05E8</a>
  </div>
</body></html>`;
}
__name(cancelPage, "cancelPage");
async function handlePrintRefreshStatus(request, env) {
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  if (!await checkAuth(request, env)) return unauth(request);
  const { orderId } = await request.json().catch(() => ({}));
  if (!orderId) return jsonRes({ error: "orderId \u05D7\u05E1\u05E8" }, 400, request);
  const order = await env.DB.prepare(
    "SELECT id, prodigi_order_id, status FROM print_orders WHERE id=?"
  ).bind(orderId).first();
  if (!order) return jsonRes({ error: "\u05D4\u05D6\u05DE\u05E0\u05D4 \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D4" }, 404, request);
  const gelatoOrderId = order.prodigi_order_id;
  if (!gelatoOrderId) return jsonRes({ error: "\u05D0\u05D9\u05DF Gelato order ID" }, 400, request);
  const gelatoRes = await fetch(
    `https://api.gelato.com/v2/order/status/${gelatoOrderId}`,
    { headers: { "X-API-KEY": env.GELATO_API_KEY } }
  );
  if (!gelatoRes.ok) {
    const err = await gelatoRes.text();
    return jsonRes({ error: `\u05E9\u05D2\u05D9\u05D0\u05EA Gelato: ${gelatoRes.status} ${err}` }, 502, request);
  }
  const gelatoData = await gelatoRes.json();
  const STATUS_MAP = {
    "created": "in_production",
    "passed": "in_production",
    "in_production": "in_production",
    "printed": "in_production",
    "shipped": "shipped",
    "delivered": "shipped",
    "cancelled": "cancelled",
    "failed": "cancelled"
  };
  const rawStatus = (gelatoData.productionStatus || "").toLowerCase();
  const newStatus = STATUS_MAP[rawStatus];
  if (newStatus && newStatus !== order.status && order.status !== "cancelled") {
    await env.DB.prepare(
      "UPDATE print_orders SET status=? WHERE id=?"
    ).bind(newStatus, orderId).run();
  }
  const tracking = gelatoData.trackingCode?.[0] || "";
  return jsonRes({
    orderId,
    previousStatus: order.status,
    status: newStatus || order.status,
    gelatoStatus: rawStatus,
    tracking,
    changed: !!(newStatus && newStatus !== order.status && order.status !== "cancelled")
  }, 200, request);
}
__name(handlePrintRefreshStatus, "handlePrintRefreshStatus");
async function handlePrintWebhook(request, env) {
  if (request.method !== "POST") return new Response("ok", { status: 200 });
  const payload = await request.json().catch(() => null);
  if (!payload) return new Response("ok", { status: 200 });
  const gelatoOrderId = payload.orderId || payload.orderReferenceId;
  const status = payload.fulfillmentStatus;
  if (!gelatoOrderId || !status) return new Response("ok", { status: 200 });
  const STATUS_MAP = {
    "created": "in_production",
    "passed": "in_production",
    "in_production": "in_production",
    "printed": "in_production",
    "shipped": "shipped",
    "delivered": "shipped",
    "cancelled": "cancelled",
    "failed": "cancelled"
  };
  const newStatus = STATUS_MAP[status.toLowerCase()];
  if (!newStatus) return new Response("ok", { status: 200 });
  await env.DB.prepare(
    "UPDATE print_orders SET status=? WHERE prodigi_order_id=? AND status != ?"
  ).bind(newStatus, gelatoOrderId, "cancelled").run();
  if (newStatus === "shipped" && env.RESEND_API_KEY) {
    const order = await env.DB.prepare(
      "SELECT * FROM print_orders WHERE prodigi_order_id=?"
    ).bind(gelatoOrderId).first();
    if (order?.customer_email) {
      const fromEmail = env.FROM_EMAIL || "amit@amitphotos.com";
      const fulfillments = payload.items?.[0]?.fulfillments || [];
      const tracking = fulfillments[0]?.trackingCode || "";
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
          <h2 style="margin:0 0 1rem">\u05E9\u05DC\u05D5\u05DD ${order.customer_name}, \u05D4\u05D4\u05D3\u05E4\u05E1\u05D4 \u05E9\u05DC\u05DA \u05D1\u05D3\u05E8\u05DA! \u{1F4E6}</h2>
          <p><strong>\u05DE\u05D5\u05E6\u05E8:</strong> ${order.product_label}</p>
          <p><strong>\u05DB\u05EA\u05D5\u05D1\u05EA:</strong> ${order.address_line1}, ${order.address_city} ${order.address_zip}</p>
          ${tracking ? `<p><strong>\u05DE\u05E1\u05E4\u05E8 \u05DE\u05E2\u05E7\u05D1:</strong> ${tracking}</p>` : ""}
          <p style="color:#888;font-size:.9rem">\u05D6\u05DE\u05DF \u05D4\u05D2\u05E2\u05D4 \u05DE\u05E9\u05D5\u05E2\u05E8: 7\u201310 \u05D9\u05DE\u05D9 \u05E2\u05E1\u05E7\u05D9\u05DD.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromEmail, to: order.customer_email, subject: "\u05D4\u05D4\u05D3\u05E4\u05E1\u05D4 \u05E9\u05DC\u05DA \u05E0\u05E9\u05DC\u05D7\u05D4! \u2014 Amit Photos", html })
      });
    }
  }
  return new Response("ok", { status: 200 });
}
__name(handlePrintWebhook, "handlePrintWebhook");
async function handlePrintOrders(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { results } = await env.DB.prepare(
    "SELECT * FROM print_orders ORDER BY created_at DESC"
  ).all();
  return jsonRes(results, 200, request);
}
__name(handlePrintOrders, "handlePrintOrders");
function buildNewsletterHtml(subject, body, unsubscribeUrl, name) {
  const safeBody = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeSubject = subject.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const greeting = name ? `\u05E9\u05DC\u05D5\u05DD ${name.replace(/&/g, "&amp;")},<br><br>` : "";
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
        <tr><td style="background:#0a0a0a;padding:28px 40px;text-align:center">
          <div style="color:#c8a96e;font-size:22px;font-weight:700;letter-spacing:.25em;font-family:Georgia,serif">AMIT PHOTOS</div>
          <div style="color:#888;font-size:11px;letter-spacing:.18em;margin-top:4px">\u05E6\u05D9\u05DC\u05D5\u05DD \u05D0\u05DE\u05E0\u05D5\u05EA\u05D9</div>
        </td></tr>
        <tr><td style="padding:36px 40px;color:#222;font-size:15px;line-height:1.85;direction:rtl;text-align:right">
          <h2 style="margin:0 0 1.2rem;font-size:18px;color:#111">${safeSubject}</h2>
          <div style="white-space:pre-wrap">${greeting}${safeBody}</div>
        </td></tr>
        <tr><td style="padding:0 40px"><hr style="border:none;border-top:1px solid #e8e8e8"></td></tr>
        <tr><td style="padding:20px 40px 28px;text-align:center">
          <p style="color:#aaa;font-size:12px;margin:0 0 6px">\u05E7\u05D9\u05D1\u05DC\u05EA \u05DE\u05D9\u05D9\u05DC \u05D6\u05D4 \u05DB\u05D9 \u05E0\u05E8\u05E9\u05DE\u05EA \u05DC\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8 \u05E9\u05DC <a href="https://amitphotos.com" style="color:#c8a96e;text-decoration:none">amitphotos.com</a></p>
          <p style="margin:0"><a href="${unsubscribeUrl}" style="color:#bbb;font-size:11px;text-decoration:underline">\u05D4\u05E1\u05E8 \u05D0\u05D5\u05EA\u05D9 \u05DE\u05D4\u05E8\u05E9\u05D9\u05DE\u05D4</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
__name(buildNewsletterHtml, "buildNewsletterHtml");
async function handleTrackEvent(request, env) {
  try {
    const { event_type, photo_id, photo_title, category } = await request.json();
    if (!["photo_view", "purchase_intent"].includes(event_type) || !photo_id) return jsonRes({ ok: false });
    await env.DB.prepare(
      "INSERT INTO photo_events (event_type, photo_id, photo_title, category, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(event_type, String(photo_id), photo_title || "", category || "", (/* @__PURE__ */ new Date()).toISOString()).run();
    return jsonRes({ ok: true });
  } catch {
    return jsonRes({ ok: false });
  }
}
__name(handleTrackEvent, "handleTrackEvent");
async function handleAdminPhotoAnalytics(request, env) {
  if (!await checkAuth(request, env)) return jsonRes({ error: "Unauthorized" }, 401, request);
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
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
    ).bind(since).all()
  ]);
  return jsonRes({ views: views.results, intents: intents.results, purchases: purchases.results });
}
__name(handleAdminPhotoAnalytics, "handleAdminPhotoAnalytics");
async function handleNewsletter(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  if (!env.RESEND_API_KEY) return jsonRes({ error: "RESEND_API_KEY \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8 \u05D1-Cloudflare" }, 500, request);
  const { subject, body } = await request.json().catch(() => ({}));
  if (!subject || !body) return jsonRes({ error: "\u05E0\u05D5\u05E9\u05D0 \u05D5\u05EA\u05D5\u05DB\u05DF \u05D4\u05DD \u05E9\u05D3\u05D5\u05EA \u05D7\u05D5\u05D1\u05D4" }, 400, request);
  const { results: subscribers } = await env.DB.prepare("SELECT id, email, name FROM subscribers").all();
  if (!subscribers.length) return jsonRes({ error: "\u05D0\u05D9\u05DF \u05E0\u05E8\u05E9\u05DE\u05D9\u05DD \u05D1\u05E8\u05E9\u05D9\u05DE\u05D4" }, 400, request);
  const fromEmail = env.FROM_EMAIL || "amit@amitphotos.com";
  const origin = new URL(request.url).origin;
  const batch = subscribers.map((sub) => ({
    from: fromEmail,
    to: sub.email,
    subject,
    html: buildNewsletterHtml(subject, body, `${origin}/api/unsubscribe?token=${sub.id}`, sub.name)
  }));
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(batch)
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg = errBody.message || errBody.name || `HTTP ${res.status}`;
    return jsonRes({ error: `\u05E9\u05D2\u05D9\u05D0\u05EA Resend: ${msg}` }, 500, request);
  }
  const data = await res.json().catch(() => ({}));
  const sent = Array.isArray(data.data) ? data.data.length : subscribers.length;
  return jsonRes({ ok: true, sent, total: subscribers.length }, 200, request);
}
__name(handleNewsletter, "handleNewsletter");
async function handleReply(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  if (!env.RESEND_API_KEY) return jsonRes({ error: "RESEND_API_KEY \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8" }, 500, request);
  const { to, subject, body } = await request.json().catch(() => ({}));
  if (!to || !subject || !body) return jsonRes({ error: "\u05D7\u05E1\u05E8\u05D9\u05DD \u05E9\u05D3\u05D5\u05EA" }, 400, request);
  const fromEmail = env.FROM_EMAIL || "amit@amitphotos.com";
  const safeBody = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromEmail, to, subject, html })
  });
  if (!res.ok) {
    const err = await res.text();
    return jsonRes({ error: `Resend: ${err}` }, 502, request);
  }
  return jsonRes({ ok: true }, 200, request);
}
__name(handleReply, "handleReply");
async function handleUnsubscribe(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const msgHtml = /* @__PURE__ */ __name((title, msg, icon) => htmlRes(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f4f4;font-family:Arial,sans-serif">
  <div style="background:#fff;border-radius:8px;padding:48px 40px;max-width:440px;width:100%;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.08)">
    <div style="color:#c8a96e;font-size:18px;font-weight:700;letter-spacing:.22em;font-family:Georgia,serif;margin-bottom:24px">AMIT PHOTOS</div>
    <div style="font-size:2rem;margin-bottom:16px">${icon}</div>
    <h2 style="margin:0 0 12px;font-size:20px;color:#111">${title}</h2>
    <p style="color:#666;font-size:14px;line-height:1.7;margin:0 0 24px">${msg}</p>
    <a href="https://amitphotos.com" style="display:inline-block;padding:.6rem 1.6rem;background:#0a0a0a;color:#c8a96e;text-decoration:none;border-radius:4px;font-size:14px">\u05D7\u05D6\u05E8\u05D4 \u05DC\u05D0\u05EA\u05E8</a>
  </div>
</body></html>`), "msgHtml");
  if (token) {
    const row = await env.DB.prepare("SELECT id FROM subscribers WHERE id=?").bind(token).first().catch(() => null);
    if (!row) return msgHtml("\u05DB\u05D1\u05E8 \u05D4\u05D5\u05E1\u05E8\u05EA", "\u05DB\u05EA\u05D5\u05D1\u05EA \u05D4\u05DE\u05D9\u05D9\u05DC \u05E9\u05DC\u05DA \u05D0\u05D9\u05E0\u05D4 \u05D1\u05E8\u05E9\u05D9\u05DE\u05D4.", "\u2139\uFE0F");
    await env.DB.prepare("DELETE FROM subscribers WHERE id=?").bind(token).run();
    return msgHtml("\u05D4\u05D5\u05E1\u05E8\u05EA \u05D1\u05D4\u05E6\u05DC\u05D7\u05D4", "\u05D4\u05D5\u05E1\u05E8\u05EA \u05DE\u05E8\u05E9\u05D9\u05DE\u05EA \u05D4\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8. \u05DC\u05D0 \u05EA\u05E7\u05D1\u05DC \u05E2\u05D5\u05D3 \u05DE\u05D9\u05D9\u05DC\u05D9\u05DD \u05DE\u05D0\u05D9\u05EA\u05E0\u05D5.", "\u2705");
  }
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const email = (body.email || "").trim().toLowerCase();
    if (!email) return jsonRes({ error: "\u05E0\u05D3\u05E8\u05E9\u05EA \u05DB\u05EA\u05D5\u05D1\u05EA \u05DE\u05D9\u05D9\u05DC" }, 400, request);
    const row = await env.DB.prepare("SELECT id FROM subscribers WHERE lower(email)=?").bind(email).first().catch(() => null);
    if (!row) return jsonRes({ ok: true, notFound: true }, 200, request);
    await env.DB.prepare("DELETE FROM subscribers WHERE id=?").bind(row.id).run();
    return jsonRes({ ok: true }, 200, request);
  }
  return msgHtml("\u05E7\u05D9\u05E9\u05D5\u05E8 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF", "\u05D4\u05E7\u05D9\u05E9\u05D5\u05E8 \u05DC\u05D4\u05E1\u05E8\u05D4 \u05D0\u05D9\u05E0\u05D5 \u05EA\u05E7\u05D9\u05DF.", "\u274C");
}
__name(handleUnsubscribe, "handleUnsubscribe");
async function trackPageView(env, request, page) {
  try {
    const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const country = request.headers.get("CF-IPCountry") || "XX";
    await env.DB.prepare(
      "INSERT INTO analytics (date, views) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET views = views + 1"
    ).bind(date).run();
    await env.DB.prepare(
      "INSERT INTO analytics_countries (date, country, views) VALUES (?, ?, 1) ON CONFLICT(date, country) DO UPDATE SET views = views + 1"
    ).bind(date, country).run();
    if (page) {
      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS analytics_pages (date TEXT NOT NULL, page TEXT NOT NULL, views INTEGER DEFAULT 0, PRIMARY KEY(date,page))"
      ).run().catch(() => {
      });
      await env.DB.prepare(
        "INSERT INTO analytics_pages (date, page, views) VALUES (?,?,1) ON CONFLICT(date,page) DO UPDATE SET views=views+1"
      ).bind(date, page).run();
    }
  } catch {
  }
}
__name(trackPageView, "trackPageView");
async function handleAnalytics(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS analytics_pages (date TEXT NOT NULL, page TEXT NOT NULL, views INTEGER DEFAULT 0, PRIMARY KEY(date,page))"
  ).run().catch(() => {
  });
  const [{ results: daily }, { results: countries }, { results: pages }, thisWeekRow, prevWeekRow] = await Promise.all([
    env.DB.prepare("SELECT date, views FROM analytics ORDER BY date DESC LIMIT 30").all(),
    env.DB.prepare(
      'SELECT country, SUM(views) as total FROM analytics_countries WHERE date >= date("now", "-30 days") GROUP BY country ORDER BY total DESC LIMIT 10'
    ).all(),
    env.DB.prepare(
      'SELECT page, SUM(views) as total FROM analytics_pages WHERE date >= date("now", "-30 days") GROUP BY page ORDER BY total DESC LIMIT 12'
    ).all(),
    env.DB.prepare('SELECT SUM(views) as total FROM analytics WHERE date >= date("now","-7 days")').first(),
    env.DB.prepare('SELECT SUM(views) as total FROM analytics WHERE date >= date("now","-14 days") AND date < date("now","-7 days")').first()
  ]);
  return jsonRes({
    daily,
    countries,
    pages: pages || [],
    weekTotal: thisWeekRow?.total || 0,
    prevWeekTotal: prevWeekRow?.total || 0
  }, 200, request);
}
__name(handleAnalytics, "handleAnalytics");
async function servePhotoPage(photoId, env) {
  let photo = null;
  try {
    const row = await env.DB.prepare(
      "SELECT id, title, description, thumbnail, url, category FROM photos WHERE id = ?"
    ).bind(photoId).first();
    if (row) photo = row;
  } catch (_) {
  }
  if (!photo) {
    try {
      const jsonRes2 = await env.ASSETS.fetch(new Request("https://amitphotos.com/data/photos.json"));
      const photos = await jsonRes2.json();
      photo = photos.find((p) => p.id === photoId) || null;
    } catch (_) {
    }
  }
  let relatedPhotos = [];
  if (photo?.category) {
    try {
      const { results } = await env.DB.prepare(
        "SELECT id, title, thumbnail FROM photos WHERE published=1 AND category=? AND id!=? ORDER BY RANDOM() LIMIT 6"
      ).bind(photo.category, photoId).all();
      relatedPhotos = results;
    } catch (_) {
    }
  }
  const title = photo?.title || "\u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6 | \u05E6\u05D9\u05DC\u05D5\u05DD \u05D0\u05DE\u05E0\u05D5\u05EA\u05D9";
  const desc = photo?.description || "\u05EA\u05DE\u05D5\u05E0\u05D5\u05EA \u05D0\u05DE\u05E0\u05D5\u05EA\u05D9\u05D5\u05EA \u05D3\u05D9\u05D2\u05D9\u05D8\u05DC\u05D9\u05D5\u05EA \u05DC\u05E8\u05DB\u05D9\u05E9\u05D4 \u2014 \u05D8\u05D1\u05E2, \u05E4\u05D5\u05E8\u05D8\u05E8\u05D8, \u05E0\u05D5\u05E4\u05D9 \u05D9\u05E9\u05E8\u05D0\u05DC \u05D5\u05E2\u05D5\u05D3.";
  const category = photo?.category || "";
  const rawUrl = photo?.url || photo?.thumbnail || "";
  const imageUrl = rawUrl.startsWith("/") ? `https://amitphotos.com${rawUrl}` : rawUrl || "https://amitphotos.com/assets/images/og-default.jpg";
  const pageUrl = `https://amitphotos.com/photo/${photoId}`;
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ImageObject",
    "name": title,
    "description": desc,
    "contentUrl": imageUrl,
    "url": pageUrl,
    "license": "https://amitphotos.com/privacy/",
    "acquireLicensePage": `https://amitphotos.com/?photo=${photoId}`,
    "creditText": "\u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6",
    "copyrightNotice": "\xA9 \u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6. \u05DB\u05DC \u05D4\u05D6\u05DB\u05D5\u05D9\u05D5\u05EA \u05E9\u05DE\u05D5\u05E8\u05D5\u05EA.",
    "creator": { "@type": "Person", "name": "\u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6", "url": "https://amitphotos.com" },
    ...category ? { "about": category } : {}
  });
  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} | \u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6 \u05E6\u05D9\u05DC\u05D5\u05DD</title>
  <meta name="description" content="${desc}" />
  <meta property="og:site_name" content="\u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6 \u05E6\u05D9\u05DC\u05D5\u05DD" />
  <meta property="og:title" content="${title} | \u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:image:alt" content="${title}" />
  <meta property="og:locale" content="he_IL" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@amite" />
  <meta name="twitter:title" content="${title} | \u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="${imageUrl}" />
  <meta name="twitter:image:alt" content="${title}" />
  <link rel="canonical" href="${pageUrl}" />
  <script type="application/ld+json">${schema}<\/script>
  ${GA_SNIPPET}
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
  <a class="back" href="https://amitphotos.com">\u2190 \u05D7\u05D6\u05E8\u05D4 \u05DC\u05D2\u05DC\u05E8\u05D9\u05D4</a>
  <div class="photo-wrap">
    <img src="${imageUrl}" alt="${title}" loading="lazy" />
  </div>
  <div class="info">
    <h1>${title}</h1>
    ${category ? `<p class="category"><a href="https://amitphotos.com/category/${encodeURIComponent(category)}" class="cat-link">\u2190 \u05DB\u05DC \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA ${category}</a></p>` : ""}
    ${desc ? `<p class="desc">${desc}</p>` : ""}
    <a class="buy" href="https://amitphotos.com/#photo-${photoId}">\u05DC\u05E8\u05DB\u05D9\u05E9\u05EA \u05D4\u05EA\u05DE\u05D5\u05E0\u05D4</a>
  </div>
  ${relatedPhotos.length ? `
  <div class="related">
    <h2>\u05EA\u05DE\u05D5\u05E0\u05D5\u05EA \u05E0\u05D5\u05E1\u05E4\u05D5\u05EA \u05DE${category}</h2>
    <div class="rel-grid">
      ${relatedPhotos.map((r) => {
    const rImg = (r.thumbnail || "").startsWith("/") ? `https://amitphotos.com${r.thumbnail}` : r.thumbnail || "";
    return `<a href="https://amitphotos.com/photo/${r.id}"><img src="${rImg}" alt="${r.title || ""}" loading="lazy" /></a>`;
  }).join("")}
    </div>
  </div>` : ""}
  <p class="credit">\xA9 \u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6 \u2014 amitphotos.com</p>
</body>
</html>`;
  return htmlRes(html, 200, "no-cache, no-store, must-revalidate");
}
__name(servePhotoPage, "servePhotoPage");
async function handleCategoryPage(category, env) {
  if (!category) return Response.redirect("https://amitphotos.com", 302);
  let photos = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, title, description, thumbnail, url FROM photos WHERE published=1 AND category=? ORDER BY sort_order ASC, created_at DESC LIMIT 200"
    ).bind(category).all();
    photos = results;
  } catch (_) {
  }
  if (!photos.length) return Response.redirect("https://amitphotos.com", 302);
  const base = "https://amitphotos.com";
  const pageUrl = `${base}/category/${encodeURIComponent(category)}`;
  const pageTitle = `\u05E6\u05D9\u05DC\u05D5\u05DE\u05D9 ${category} | \u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6`;
  const pageDesc = `${photos.length} \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA \u05E6\u05D9\u05DC\u05D5\u05DD \u05DE${category} \u05DE\u05D0\u05EA \u05D4\u05E6\u05DC\u05DD \u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6. \u05DB\u05DC \u05D4\u05EA\u05DE\u05D5\u05E0\u05D5\u05EA \u05D6\u05DE\u05D9\u05E0\u05D5\u05EA \u05DC\u05E8\u05DB\u05D9\u05E9\u05D4 \u05D5\u05DC\u05D4\u05D5\u05E8\u05D3\u05D4 \u05D3\u05D9\u05D2\u05D9\u05D8\u05DC\u05D9\u05EA.`;
  const ogImage = photos[0]?.thumbnail?.startsWith("/") ? `${base}${photos[0].thumbnail}` : photos[0]?.thumbnail || "";
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": pageTitle,
    "description": pageDesc,
    "url": pageUrl,
    "numberOfItems": photos.length,
    "creator": { "@type": "Person", "name": "\u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6", "url": base },
    "hasPart": photos.slice(0, 10).map((p) => ({
      "@type": "ImageObject",
      "name": p.title || category,
      "url": `${base}/photo/${p.id}`,
      "contentUrl": p.thumbnail?.startsWith("/") ? `${base}${p.thumbnail}` : p.thumbnail
    }))
  });
  const cards = photos.map((p) => {
    const img = p.thumbnail?.startsWith("/") ? `${base}${p.thumbnail}` : p.thumbnail || "";
    const title = p.title || category;
    return `<a href="${base}/photo/${p.id}" class="card">
      <img src="${img}" alt="${escXml(title)}" loading="lazy" />
      <span>${escXml(title)}</span>
    </a>`;
  }).join("\n");
  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${pageTitle}</title>
  <meta name="description" content="${pageDesc}" />
  <meta property="og:site_name" content="\u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6 \u05E6\u05D9\u05DC\u05D5\u05DD" />
  <meta property="og:title" content="${pageTitle}" />
  <meta property="og:description" content="${pageDesc}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${pageUrl}" />
  ${ogImage ? `<meta property="og:image" content="${ogImage}" /><meta property="og:image:alt" content="${escXml(category)}" />` : ""}
  <meta property="og:locale" content="he_IL" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${pageTitle}" />
  <meta name="twitter:description" content="${pageDesc}" />
  ${ogImage ? `<meta name="twitter:image" content="${ogImage}" />` : ""}
  <link rel="canonical" href="${pageUrl}" />
  <script type="application/ld+json">${schema}<\/script>
  ${GA_SNIPPET}
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
  <a class="back" href="${base}">\u2190 \u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6 | \u05D2\u05DC\u05E8\u05D9\u05D4</a>
  <h1>\u05E6\u05D9\u05DC\u05D5\u05DE\u05D9 ${escXml(category)}</h1>
  <p class="sub">${photos.length} \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA \xB7 \u05E6\u05DC\u05DD: \u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6</p>
  <div class="grid">${cards}</div>
  <div class="footer">
    <a class="btn" href="${base}">\u05DC\u05DB\u05DC \u05D4\u05D2\u05DC\u05E8\u05D9\u05D4</a>
  </div>
</body>
</html>`;
  return htmlRes(html, 200, "no-cache, no-store, must-revalidate");
}
__name(handleCategoryPage, "handleCategoryPage");
async function servePhoto(key, env, request) {
  const url = new URL(request.url);
  const w = parseInt(url.searchParams.get("w")) || 0;
  if (w && !request.headers.get("x-no-resize")) {
    try {
      const origin = url.origin;
      const resized = await fetch(`${origin}/photos/${key}`, {
        cf: { image: { width: w, quality: 75, format: "webp" } },
        headers: { "x-no-resize": "1" }
      });
      if (resized.ok) {
        const headers = new Headers(resized.headers);
        headers.set("Cache-Control", "public, max-age=31536000, immutable");
        headers.set("Access-Control-Allow-Origin", "*");
        return new Response(resized.body, { headers });
      }
    } catch (_) {
    }
  }
  const object = await env.PHOTOS.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
__name(servePhoto, "servePhoto");
async function handleImageProxy(request, env) {
  const urlParam = new URL(request.url).searchParams.get("url");
  if (!urlParam) return new Response("url missing", { status: 400 });
  let urlObj;
  try {
    urlObj = new URL(urlParam);
  } catch {
    return new Response("invalid url", { status: 400 });
  }
  const allowedHosts = ["drive.google.com", "lh3.googleusercontent.com", "googleusercontent.com"];
  const host = urlObj.hostname;
  const sameOrigin = urlParam.startsWith(new URL(request.url).origin);
  if (!sameOrigin && !allowedHosts.some((h) => host === h || host.endsWith("." + h))) {
    return new Response("domain not allowed", { status: 403 });
  }
  const res = await fetch(urlParam);
  if (!res.ok) return new Response("fetch failed", { status: res.status });
  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
__name(handleImageProxy, "handleImageProxy");
async function handlePrintUploadCrop(request, env) {
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  const body = await request.arrayBuffer().catch(() => null);
  if (!body || !body.byteLength) return jsonRes({ error: "\u05D2\u05D5\u05E3 \u05E8\u05D9\u05E7" }, 400, request);
  const key = `crop-${crypto.randomUUID()}.jpg`;
  await env.PHOTOS.put(key, body, { httpMetadata: { contentType: "image/jpeg" } });
  const origin = new URL(request.url).origin;
  return jsonRes({ url: `${origin}/photos/${key}` }, 200, request);
}
__name(handlePrintUploadCrop, "handlePrintUploadCrop");
async function handleSitemap(request, env) {
  const base = "https://amitphotos.com";
  function absUrl(u) {
    if (!u) return "";
    return u.startsWith("http") ? u : `${base}${u.startsWith("/") ? "" : "/"}${u}`;
  }
  __name(absUrl, "absUrl");
  const now = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  function toDate(str) {
    if (!str) return now;
    const d = new Date(str);
    return isNaN(d.getTime()) ? now : d.toISOString().split("T")[0];
  }
  __name(toDate, "toDate");
  const staticPages = [
    { loc: "/", priority: "1.0", changefreq: "daily" },
    { loc: "/learn/", priority: "0.8", changefreq: "weekly" },
    { loc: "/camera/", priority: "0.9", changefreq: "weekly" },
    { loc: "/camera/composition/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/controls/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/depth-of-field/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/dynamic-range/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/editing/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/exposure/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/filters/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/focus/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/histogram/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/landscape/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/lenses/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/light/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/macro/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/portrait/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/software/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/sports/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/types/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/visual-language/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/white-balance/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/black-and-white/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/color-channels/", priority: "0.8", changefreq: "monthly" },
    { loc: "/camera/mobile/", priority: "0.8", changefreq: "monthly" },
    { loc: "/gear/", priority: "0.7", changefreq: "monthly" },
    { loc: "/locations/", priority: "0.8", changefreq: "weekly" },
    { loc: "/newsletter/", priority: "0.6", changefreq: "weekly" },
    { loc: "/games/", priority: "0.7", changefreq: "monthly" },
    { loc: "/quiz/", priority: "0.7", changefreq: "monthly" },
    { loc: "/puzzle/", priority: "0.7", changefreq: "monthly" },
    { loc: "/sale/", priority: "0.7", changefreq: "weekly" },
    { loc: "/privacy/", priority: "0.3", changefreq: "yearly" }
  ];
  let categoryUrls = [];
  try {
    const { results: cats } = await env.DB.prepare(
      "SELECT DISTINCT category, MAX(created_at) as last FROM photos WHERE published=1 AND category!=? GROUP BY category"
    ).bind("").all();
    categoryUrls = cats.map((c) => `  <url>
    <loc>${base}/category/${escXml(encodeURIComponent(c.category))}</loc>
    <lastmod>${toDate(c.last)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`);
  } catch (_) {
  }
  let photoUrls = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, title, thumbnail, category, created_at FROM photos WHERE published=1 ORDER BY created_at DESC LIMIT 1000"
    ).all();
    photoUrls = results.map((p) => {
      const lastmod = toDate(p.created_at);
      const imageTag = p.thumbnail ? `
    <image:image>
      <image:loc>${escXml(absUrl(p.thumbnail))}</image:loc>
      <image:title>${escXml(p.title || "")}</image:title>
      <image:caption>${escXml(p.category || "")}</image:caption>
    </image:image>` : "";
      return `  <url>
    <loc>${base}/photo/${escXml(p.id)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>${imageTag}
  </url>`;
    });
  } catch {
  }
  const staticXml = staticPages.map((p) => `  <url>
    <loc>${base}${p.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join("\n");
  let learnUrls = [];
  try {
    const { results: analyses } = await env.DB.prepare(
      "SELECT photo_id, published_at FROM photo_analyses ORDER BY published_at DESC"
    ).all();
    learnUrls = analyses.map((a) => `  <url>
    <loc>${base}/learn/${escXml(a.photo_id)}</loc>
    <lastmod>${toDate(a.published_at)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`);
  } catch (_) {
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${staticXml}
${categoryUrls.join("\n")}
${photoUrls.join("\n")}
${learnUrls.join("\n")}
</urlset>`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=UTF-8",
      "Cache-Control": "public, max-age=900, s-maxage=0"
      // edge: no cache; browser: 15min
    }
  });
}
__name(handleSitemap, "handleSitemap");
function escXml(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
__name(escXml, "escXml");
async function handleLocationSpotPage(request, env) {
  const params = new URL(request.url).searchParams;
  const slug = params.get("slug") || params.get("id");
  if (!slug || slug.length > 200 || slug.includes("${") || slug.includes("escHtml") || slug.includes("encodeURI")) {
    return new Response("Not Found", { status: 404 });
  }
  const loc = await env.DB.prepare(
    "SELECT id, title, description, region, coordinates FROM locations WHERE id = ? AND published = 1"
  ).bind(slug).first().catch(() => null);
  if (!loc) {
    return new Response("Not Found", { status: 404 });
  }
  const assetRes = await env.ASSETS.fetch(new Request(new URL("/locations/spot/", request.url).href));
  if (!assetRes.ok) return assetRes;
  let html = await assetRes.text();
  const title = escXml(loc.title + " | \u05DE\u05E7\u05D5\u05DE\u05D5\u05EA \u05DC\u05E6\u05D9\u05DC\u05D5\u05DD \u2014 \u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6");
  const desc = escXml((loc.description || "").slice(0, 160));
  const canonicalUrl = `https://amitphotos.com/locations/spot/?slug=${encodeURIComponent(loc.id)}`;
  const pageUrl = escXml(canonicalUrl);
  const cover = await env.DB.prepare(
    "SELECT url FROM location_photos WHERE location_id = ? ORDER BY sort_order ASC LIMIT 1"
  ).bind(slug).first().catch(() => null);
  const imgUrl = escXml(cover?.url || "https://amitphotos.com/assets/img/og-default.jpg");
  const locationSchema = {
    "@context": "https://schema.org",
    "@type": "TouristAttraction",
    "name": loc.title,
    "description": (loc.description || "").slice(0, 300),
    "url": canonicalUrl,
    "image": cover?.url || "",
    "inLanguage": "he",
    ...loc.coordinates ? (() => {
      try {
        const c = JSON.parse(loc.coordinates);
        return c.lat && c.lng ? { "geo": { "@type": "GeoCoordinates", "latitude": c.lat, "longitude": c.lng } } : {};
      } catch (_) {
        return {};
      }
    })() : {},
    "creator": { "@type": "Person", "name": "\u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6", "url": "https://amitphotos.com" },
    "isPartOf": { "@type": "WebSite", "name": "Amit Photos", "url": "https://amitphotos.com" }
  };
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
  <meta name="twitter:image" content="${imgUrl}">
  <script type="application/ld+json">${JSON.stringify(locationSchema)}<\/script>`;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`).replace("</head>", ogTags + "\n</head>");
  return htmlRes(html, 200, "no-cache, no-store, must-revalidate");
}
__name(handleLocationSpotPage, "handleLocationSpotPage");
function handleRobots(request) {
  const base = "https://amitphotos.com";
  const txt = `User-agent: *
Disallow: /api/
Disallow: /admin.html

Sitemap: ${base}/sitemap.xml`;
  return new Response(txt, {
    headers: {
      "Content-Type": "text/plain; charset=UTF-8",
      "Cache-Control": "public, max-age=86400"
    }
  });
}
__name(handleRobots, "handleRobots");
async function getNewBadgeDays(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'new_badge_days'").first();
  return parseInt(row?.value || "7", 10);
}
__name(getNewBadgeDays, "getNewBadgeDays");
async function handleNewBadgeSettings(request, env) {
  if (request.method === "GET") {
    const days = await getNewBadgeDays(env);
    return jsonRes({ days }, 200, request);
  }
  if (request.method === "POST") {
    if (!await checkAuth(request, env)) return unauth(request);
    const { days } = await request.json().catch(() => ({}));
    if (!days || isNaN(days) || days < 1) return jsonRes({ error: "invalid days" }, 400, request);
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('new_badge_days', ?)").bind(String(days)).run();
    return jsonRes({ ok: true, days }, 200, request);
  }
  return jsonRes({ error: "method not allowed" }, 405, request);
}
__name(handleNewBadgeSettings, "handleNewBadgeSettings");
async function getGlobalPrices(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key='prices'").first();
  if (row?.value) {
    try {
      return JSON.parse(row.value);
    } catch {
    }
  }
  return { small: 19, medium: 59, large: 129 };
}
__name(getGlobalPrices, "getGlobalPrices");
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
  if (!results.length) return jsonRes({ error: "\u05D0\u05D9\u05DF \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA \u05D6\u05DE\u05D9\u05E0\u05D5\u05EA" }, 404, request);
  const bottomCount = Math.max(1, Math.floor(results.length * 0.2));
  const candidates = results.slice(0, bottomCount);
  const photo = candidates[Math.floor(Math.random() * candidates.length)];
  return jsonRes({ photo: { id: photo.id, title: photo.title, thumbnail: photo.thumbnail } }, 200, request);
}
__name(handlePhotoOfWeekSuggest, "handlePhotoOfWeekSuggest");
async function handlePhotoOfWeekSet(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { photo_id } = await request.json().catch(() => ({}));
  if (!photo_id) return jsonRes({ error: "photo_id required" }, 400, request);
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('photo_of_week_id', ?)").bind(photo_id).run();
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('photo_of_week_discount', '0.25')").run();
  await env.DB.prepare("DELETE FROM settings WHERE key IN ('photo_of_week_caption','photo_of_week_caption_en')").run();
  dispatchWorkflow("week-photo-social.yml", env);
  return jsonRes({ ok: true }, 200, request);
}
__name(handlePhotoOfWeekSet, "handlePhotoOfWeekSet");
async function handlePhotoOfWeekClear(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  await env.DB.prepare("DELETE FROM settings WHERE key IN ('photo_of_week_id','photo_of_week_caption','photo_of_week_caption_en')").run();
  return jsonRes({ ok: true }, 200, request);
}
__name(handlePhotoOfWeekClear, "handlePhotoOfWeekClear");
async function handlePhotoOfWeekCaption(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const bearerValid = env.ADMIN_PASSWORD && authHeader === `Bearer ${env.ADMIN_PASSWORD}`;
  if (!bearerValid && !await checkAuth(request, env)) return unauth(request);
  const { caption, caption_en } = await request.json().catch(() => ({}));
  if (!caption) return jsonRes({ error: "caption required" }, 400, request);
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('photo_of_week_caption', ?)").bind(caption).run();
  if (caption_en) await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('photo_of_week_caption_en', ?)").bind(caption_en).run();
  return jsonRes({ ok: true }, 200, request);
}
__name(handlePhotoOfWeekCaption, "handlePhotoOfWeekCaption");
async function handleAdminPrices(request, env) {
  if (request.method === "GET") {
    const prices = await getGlobalPrices(env);
    return jsonRes(prices, 200, request);
  }
  if (request.method === "POST") {
    if (!await checkAuth(request, env)) return unauth(request);
    const body = await request.json().catch(() => ({}));
    const { small, medium, large } = body;
    if ([small, medium, large].some((v) => isNaN(parseFloat(v)) || parseFloat(v) < 0))
      return jsonRes({ error: "\u05DE\u05D7\u05D9\u05E8 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF" }, 400, request);
    const prices = { small: parseFloat(small), medium: parseFloat(medium), large: parseFloat(large) };
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('prices', ?)").bind(JSON.stringify(prices)).run();
    return jsonRes({ ok: true, prices }, 200, request);
  }
  return jsonRes({ error: "method not allowed" }, 405, request);
}
__name(handleAdminPrices, "handleAdminPrices");
async function handlePhotosReorder(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const orders = await request.json().catch(() => null);
  if (!Array.isArray(orders)) return jsonRes({ error: "expected array [{id, sort_order}]" }, 400, request);
  for (const { id, sort_order } of orders) {
    await env.DB.prepare("UPDATE photos SET sort_order=? WHERE id=?").bind(sort_order, id).run();
  }
  return jsonRes({ ok: true, updated: orders.length }, 200, request);
}
__name(handlePhotosReorder, "handlePhotosReorder");
async function handleAdminPhotoPrice(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { photo_id, price_override } = await request.json().catch(() => ({}));
  if (!photo_id) return jsonRes({ error: "photo_id required" }, 400, request);
  const val = price_override === null ? null : JSON.stringify(price_override);
  await env.DB.prepare("UPDATE photos SET price_overrides = ? WHERE id = ?").bind(val, photo_id).run();
  return jsonRes({ ok: true }, 200, request);
}
__name(handleAdminPhotoPrice, "handleAdminPhotoPrice");
async function handleAdminPhotoDimensions(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { updates } = await request.json().catch(() => ({}));
  if (!Array.isArray(updates) || !updates.length) return jsonRes({ error: "updates array required" }, 400, request);
  const stmt = env.DB.prepare("UPDATE photos SET width=?, height=? WHERE id=?");
  await env.DB.batch(updates.map(({ id, width, height }) => stmt.bind(width, height, id)));
  return jsonRes({ ok: true, updated: updates.length }, 200, request);
}
__name(handleAdminPhotoDimensions, "handleAdminPhotoDimensions");
async function handleAdminReplacePhoto(request, env, photoId) {
  if (!await checkAuth(request, env)) return unauth(request);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return jsonRes({ error: "empty body" }, 400, request);
  const url = new URL(request.url);
  const width = parseInt(url.searchParams.get("width") || "0");
  const height = parseInt(url.searchParams.get("height") || "0");
  await env.BUCKET.put(`${photoId}.jpg`, bytes, { httpMetadata: { contentType: "image/jpeg" } });
  if (width && height) {
    await env.DB.prepare("UPDATE photos SET width=?, height=? WHERE id=?").bind(width, height, photoId).run();
  }
  return jsonRes({ ok: true }, 200, request);
}
__name(handleAdminReplacePhoto, "handleAdminReplacePhoto");
async function handleUploadStory(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return jsonRes({ error: "empty body" }, 400, request);
  await env.BUCKET.put("story/latest.jpg", bytes, { httpMetadata: { contentType: "image/jpeg" } });
  const url = `${new URL(request.url).origin}/photos/story/latest.jpg`;
  return jsonRes({ url }, 200, request);
}
__name(handleUploadStory, "handleUploadStory");
async function handleAdminFeatured(request, env) {
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key='featured_ids'").first();
    const ids = row?.value ? JSON.parse(row.value).filter(Boolean) : [];
    return jsonRes({ ids }, 200, request);
  }
  if (request.method === "POST") {
    if (!await checkAuth(request, env)) return unauth(request);
    const { ids } = await request.json().catch(() => ({}));
    if (!Array.isArray(ids)) return jsonRes({ error: "ids array required" }, 400, request);
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('featured_ids', ?)").bind(JSON.stringify(ids)).run();
    return jsonRes({ ok: true }, 200, request);
  }
  return jsonRes({ error: "method not allowed" }, 405, request);
}
__name(handleAdminFeatured, "handleAdminFeatured");
async function handlePricesPage(request, env) {
  const prices = await getGlobalPrices(env);
  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>\u05DE\u05D7\u05D9\u05E8\u05D9\u05DD \u2014 \u05E2\u05DE\u05D9\u05EA \u05E6\u05D9\u05DC\u05D5\u05DD</title>
${GA_SNIPPET}
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
<h1>\u05DE\u05D7\u05D9\u05E8\u05D9 \u05D4\u05D5\u05E8\u05D3\u05D4</h1>
<p class="subtitle">\u05E7\u05D1\u05E6\u05D9\u05DD \u05D3\u05D9\u05D2\u05D9\u05D8\u05DC\u05D9\u05D9\u05DD \u05D1\u05D0\u05D9\u05DB\u05D5\u05EA \u05D2\u05D1\u05D5\u05D4\u05D4 \u2014 \u05D4\u05D5\u05E8\u05D3\u05D4 \u05DE\u05D9\u05D9\u05D3\u05D9\u05EA \u05DC\u05D0\u05D7\u05E8 \u05EA\u05E9\u05DC\u05D5\u05DD</p>
<div class="cards">
  <div class="card">
    <div class="card-label">S</div>
    <div class="card-size">\u05E7\u05D8\u05DF</div>
    <div class="card-dims">2000\xD71333 \u05E4\u05D9\u05E7\u05E1\u05DC</div>
    <div class="card-price">\u20AA${prices.small}</div>
    <div class="card-mp">~6MP \xB7 \u05D4\u05D3\u05E4\u05E1\u05D4 \u05E2\u05D3 10\xD715 \u05E1"\u05DE</div>
  </div>
  <div class="card">
    <div class="card-label">M</div>
    <div class="card-size">\u05D1\u05D9\u05E0\u05D5\u05E0\u05D9</div>
    <div class="card-dims">4000\xD72667 \u05E4\u05D9\u05E7\u05E1\u05DC</div>
    <div class="card-price">\u20AA${prices.medium}</div>
    <div class="card-mp">~24MP \xB7 \u05D4\u05D3\u05E4\u05E1\u05D4 21\xD730 \u05E1"\u05DE</div>
  </div>
  <div class="card">
    <div class="card-label">L</div>
    <div class="card-size">\u05D2\u05D3\u05D5\u05DC</div>
    <div class="card-dims">6000\xD74000 \u05E4\u05D9\u05E7\u05E1\u05DC</div>
    <div class="card-price">\u20AA${prices.large}</div>
    <div class="card-mp">~54MP \xB7 A2 \u05D5\u05DE\u05E2\u05DC\u05D4</div>
  </div>
</div>
<p class="note">\u05DB\u05DC \u05D4\u05EA\u05DE\u05D5\u05E0\u05D5\u05EA \u05E0\u05DE\u05DB\u05E8\u05D5\u05EA \u05DC\u05E9\u05D9\u05DE\u05D5\u05E9 \u05D0\u05D9\u05E9\u05D9 \u05D1\u05DC\u05D1\u05D3. \u05DC\u05E9\u05D9\u05DE\u05D5\u05E9 \u05DE\u05E1\u05D7\u05E8\u05D9 \u2014 <a href="/#contact" style="color:#c8a96e">\u05E6\u05E8\u05D5 \u05E7\u05E9\u05E8</a>.</p>
<a class="back" href="/">\u2190 \u05D7\u05D6\u05E8\u05D4 \u05DC\u05D2\u05DC\u05E8\u05D9\u05D4</a>
</body>
</html>`;
  return htmlRes(html, 200, "no-cache, no-store, must-revalidate");
}
__name(handlePricesPage, "handlePricesPage");
async function handleTogglePhotoNew(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { photo_id, is_new, title, category, url, thumbnail } = await request.json().catch(() => ({}));
  if (!photo_id) return jsonRes({ error: "photo_id required" }, 400, request);
  const addedAt = is_new ? (/* @__PURE__ */ new Date()).toISOString().split("T")[0] : null;
  const result = await env.DB.prepare(
    "UPDATE photos SET is_new = ?, added_at = CASE WHEN ? IS NOT NULL THEN ? ELSE added_at END WHERE id = ?"
  ).bind(is_new ? 1 : 0, addedAt, addedAt, photo_id).run();
  if ((result.meta?.changes ?? result.changes ?? 0) === 0 && is_new) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO photos (id, title, category, url, thumbnail, is_new, published, created_at) VALUES (?,?,?,?,?,1,1,datetime('now'))"
    ).bind(photo_id, title || "", category || "", url || "", thumbnail || "").run();
  }
  return jsonRes({ ok: true }, 200, request);
}
__name(handleTogglePhotoNew, "handleTogglePhotoNew");
async function handleAdminPurchases(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") || "all";
  const now = Math.floor(Date.now() / 1e3);
  let whereClauses = [];
  if (filter === "active") whereClauses.push(`t.used = 0 AND t.expires_at > ${now}`);
  if (filter === "used") whereClauses.push(`t.used = 1`);
  if (filter === "expired") whereClauses.push(`t.used = 0 AND t.expires_at <= ${now}`);
  const where = whereClauses.length ? `WHERE ${whereClauses[0]}` : "";
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
      SUM(CASE WHEN created_at >= ${now - 30 * 86400} THEN 1 ELSE 0 END) as this_month,
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
    WHERE created_at >= ${now - 30 * 86400}
    GROUP BY day
    ORDER BY day ASC
  `).all();
  return jsonRes({
    tokens: rows.results,
    stats: { ...stats, top_photos: topPhotos.results, daily_revenue: dailyRev.results }
  }, 200, request);
}
__name(handleAdminPurchases, "handleAdminPurchases");
async function handleAdminCreateToken(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { photo_id, size } = await request.json().catch(() => ({}));
  if (!photo_id || !size) return jsonRes({ error: "photo_id and size required" }, 400, request);
  const VALID_SIZES = ["small", "medium", "large"];
  if (!VALID_SIZES.includes(size)) return jsonRes({ error: "invalid size" }, 400, request);
  const now = Math.floor(Date.now() / 1e3);
  const expires = now + 30 * 86400;
  const token = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at, amount) VALUES (?, ?, ?, ?, 0, ?, ?, 0)"
  ).bind(token, JSON.stringify([photo_id]), size, `MANUAL_${token.slice(0, 8)}`, expires, now).run();
  const origin = new URL(request.url).origin;
  return jsonRes({ token, url: `${origin}/api/download/${token}` }, 200, request);
}
__name(handleAdminCreateToken, "handleAdminCreateToken");
async function handleMigrateAnalyses(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "POST only" }, 405, request);
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
    return jsonRes({ ok: true, message: "photo_analyses table ready" }, 200, request);
  } catch (e) {
    return jsonRes({ error: String(e) }, 500, request);
  }
}
__name(handleMigrateAnalyses, "handleMigrateAnalyses");
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
__name(handleAnalysesList, "handleAnalysesList");
async function handleAnalysesGet(request, env, photoId) {
  if (!await checkAuth(request, env)) return unauth(request);
  try {
    const row = await env.DB.prepare(
      `SELECT a.*, p.thumbnail AS photo_thumbnail, p.url AS photo_url, p.title AS photo_title
       FROM photo_analyses a
       LEFT JOIN photos p ON p.id = a.photo_id
       WHERE a.photo_id = ?`
    ).bind(photoId).first();
    if (!row) return jsonRes({ error: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" }, 404, request);
    return jsonRes({
      ...row,
      annotations: JSON.parse(row.annotations_json || "[]"),
      camera: JSON.parse(row.camera_json || "{}"),
      tags: JSON.parse(row.tags_json || "[]")
    }, 200, request);
  } catch (e) {
    return jsonRes({ error: String(e) }, 500, request);
  }
}
__name(handleAnalysesGet, "handleAnalysesGet");
async function handleAnalysesPublishAll(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare("UPDATE photo_analyses SET published_at = ?").bind(now).run();
  return jsonRes({ ok: true }, 200, request);
}
__name(handleAnalysesPublishAll, "handleAnalysesPublishAll");
async function handleAnalysesUpdate(request, env, photoId) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "PUT") return jsonRes({ error: "PUT only" }, 405, request);
  const body = await request.json().catch(() => ({}));
  const fields = [];
  const values = [];
  if (body.composition_rule !== void 0) {
    fields.push("composition_rule = COALESCE(?, composition_rule)");
    values.push(body.composition_rule || null);
  }
  if (body.composition_html !== void 0) {
    fields.push("composition_html = ?");
    values.push(body.composition_html);
  }
  if (body.tags_json !== void 0) {
    fields.push("tags_json = ?");
    values.push(body.tags_json);
  }
  if (body.camera_json !== void 0) {
    fields.push("camera_json = ?");
    values.push(body.camera_json);
  }
  if (body.annotations_json !== void 0) {
    fields.push("annotations_json = ?");
    values.push(body.annotations_json);
  }
  if (body.title !== void 0) {
    fields.push("title = ?");
    values.push(body.title);
  }
  if (body.published_at !== void 0) {
    fields.push("published_at = ?");
    values.push(body.published_at);
  }
  if (body.title_en !== void 0) {
    fields.push("title_en = ?");
    values.push(body.title_en);
  }
  if (body.composition_html_en !== void 0) {
    fields.push("composition_html_en = ?");
    values.push(body.composition_html_en);
  }
  if (body.camera_json_en !== void 0) {
    fields.push("camera_json_en = ?");
    values.push(body.camera_json_en);
  }
  if (body.tags_json_en !== void 0) {
    fields.push("tags_json_en = ?");
    values.push(body.tags_json_en);
  }
  if (!fields.length) return jsonRes({ error: "\u05D0\u05D9\u05DF \u05E9\u05D3\u05D5\u05EA \u05DC\u05E2\u05D3\u05DB\u05D5\u05DF" }, 400, request);
  values.push(photoId);
  await env.DB.prepare(`UPDATE photo_analyses SET ${fields.join(", ")} WHERE photo_id = ?`).bind(...values).run();
  return jsonRes({ ok: true }, 200, request);
}
__name(handleAnalysesUpdate, "handleAnalysesUpdate");
async function handleAnalysesDedup(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "POST only" }, 405, request);
  const { results: all } = await env.DB.prepare(`
    SELECT a.photo_id, a.published_at, a.title,
           p.r2_key, p.thumbnail
    FROM photo_analyses a
    LEFT JOIN photos p ON p.id = a.photo_id
    ORDER BY a.published_at DESC NULLS LAST
  `).all();
  const toDelete = [];
  const seenR2 = /* @__PURE__ */ new Set();
  const seenThumb = /* @__PURE__ */ new Set();
  const seenTitle = /* @__PURE__ */ new Set();
  for (const row of all || []) {
    const key = row.r2_key && row.r2_key !== "" ? row.r2_key : null;
    const thumb = row.thumbnail && row.thumbnail !== "" ? row.thumbnail : null;
    const title = (row.title || "").trim().toLowerCase();
    const isDupe = key && seenR2.has(key) || thumb && seenThumb.has(thumb) || title && seenTitle.has(title);
    if (isDupe) {
      toDelete.push(row.photo_id);
    } else {
      if (key) seenR2.add(key);
      if (thumb) seenThumb.add(thumb);
      if (title) seenTitle.add(title);
    }
  }
  for (const id of toDelete) {
    await env.DB.prepare("DELETE FROM photo_analyses WHERE photo_id = ?").bind(id).run();
  }
  return jsonRes({ deleted: toDelete.length, ids: toDelete }, 200, request);
}
__name(handleAnalysesDedup, "handleAnalysesDedup");
async function handleAnalysesDelete(request, env, photoId) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "DELETE") return jsonRes({ error: "DELETE only" }, 405, request);
  try {
    await env.DB.prepare("DELETE FROM photo_analyses WHERE photo_id = ?").bind(photoId).run();
    return jsonRes({ ok: true }, 200, request);
  } catch (e) {
    return jsonRes({ error: String(e) }, 500, request);
  }
}
__name(handleAnalysesDelete, "handleAnalysesDelete");
async function handleAnalysesGenerateEn(request, env, photoId) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "POST only" }, 405, request);
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: "ANTHROPIC_API_KEY \u05D7\u05E1\u05E8" }, 500, request);
  const row = await env.DB.prepare("SELECT * FROM photo_analyses WHERE photo_id = ?").bind(photoId).first();
  if (!row) return jsonRes({ error: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" }, 404, request);
  let camera = {};
  try {
    camera = JSON.parse(row.camera_json || "{}");
  } catch (_) {
  }
  let annotations = [];
  try {
    annotations = JSON.parse(row.annotations_json || "[]");
  } catch (_) {
  }
  const cameraStr = ["aperture", "shutter", "iso", "focal"].map((k) => {
    const c = camera[k] || {};
    return c.value ? `${k}: value="${c.value}", explanation="${c.explanation || ""}"` : "";
  }).filter(Boolean).join("\n");
  let tags = [];
  try {
    tags = JSON.parse(row.tags_json || "[]");
  } catch (_) {
  }
  const annLabels = annotations.filter((a) => a.label).map((a, i) => `${i}: "${a.label.replace(/\n/g, "\\n")}"`).join("\n");
  const tagsStr = tags.join(", ");
  const prompt = `You are Amit Erez, an Israeli fine-art photographer writing educational photo analyses for an international audience.
Translate the following Hebrew photography analysis to English. Write in first person, personal and inspiring tone.

Photo title: ${row.title}
Composition rule: ${row.composition_rule}

Camera settings (translate only the explanation, keep the value as-is):
${cameraStr}

Composition analysis HTML (translate text content only, preserve all HTML tags exactly):
${row.composition_html || ""}

${annLabels ? `Annotation labels on the photo (short, concise labels \u2014 keep \\n for line breaks):
${annLabels}` : ""}

${tagsStr ? `Tags (translate to short English keywords, same count):
${tagsStr}` : ""}

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
  "annotation_labels_en": {"0": "English label", "1": "English label"}` : ""}${tagsStr ? `,
  "tags_en": ["tag1", "tag2", "tag3"]` : ""}
}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 2e3, messages: [{ role: "user", content: prompt }] })
  });
  if (!res.ok) return jsonRes({ error: "Claude API \u05E0\u05DB\u05E9\u05DC", status: res.status }, 502, request);
  const data = await res.json();
  const text = (data.content?.[0]?.text || "").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return jsonRes({ error: "JSON \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF" }, 500, request);
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return jsonRes({ error: "JSON \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF" }, 500, request);
    }
  }
  const camEnMerged = {};
  for (const k of ["aperture", "shutter", "iso", "focal"]) {
    const orig = camera[k] || {};
    const trans = (parsed.camera_json_en || {})[k] || {};
    camEnMerged[k] = { value: orig.value, explanation: trans.explanation || orig.explanation || "" };
  }
  const annLabelsEn = parsed.annotation_labels_en || {};
  let annIdx = 0;
  const annotationsUpdated = annotations.map((a) => {
    if (!a.label) return a;
    const en = annLabelsEn[String(annIdx++)];
    return en ? { ...a, label_en: en.replace(/\\n/g, "\n") } : a;
  });
  const tagsEnJson = parsed.tags_en && Array.isArray(parsed.tags_en) && parsed.tags_en.length ? JSON.stringify(parsed.tags_en) : null;
  try {
    await env.DB.prepare("ALTER TABLE photo_analyses ADD COLUMN tags_json_en TEXT DEFAULT '[]'").run();
  } catch (_) {
  }
  const updateFields = tagsEnJson ? "title_en=?, composition_html_en=?, camera_json_en=?, annotations_json=?, tags_json_en=?" : "title_en=?, composition_html_en=?, camera_json_en=?, annotations_json=?";
  const updateValues = tagsEnJson ? [parsed.title_en || row.title, parsed.composition_html_en || row.composition_html || "", JSON.stringify(camEnMerged), JSON.stringify(annotationsUpdated), tagsEnJson, photoId] : [parsed.title_en || row.title, parsed.composition_html_en || row.composition_html || "", JSON.stringify(camEnMerged), JSON.stringify(annotationsUpdated), photoId];
  await env.DB.prepare(`UPDATE photo_analyses SET ${updateFields} WHERE photo_id=?`).bind(...updateValues).run();
  return jsonRes({ ok: true, title_en: parsed.title_en }, 200, request);
}
__name(handleAnalysesGenerateEn, "handleAnalysesGenerateEn");
async function handleAnalysesGenerate(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "POST only" }, 405, request);
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: "ANTHROPIC_API_KEY \u05D7\u05E1\u05E8" }, 500, request);
  const body = await request.json().catch(() => ({}));
  const requestedPhotoId = body?.photo_id ?? null;
  let candidates;
  if (requestedPhotoId) {
    const { results } = await env.DB.prepare(`
      SELECT id, title, thumbnail, url, r2_key, description
      FROM photos
      WHERE id = ?
    `).bind(requestedPhotoId).all();
    candidates = results;
    if (!candidates || candidates.length === 0) {
      return jsonRes({ error: "\u05EA\u05DE\u05D5\u05E0\u05D4 \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D4" }, 404, request);
    }
  } else {
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
      return jsonRes({ error: "\u05D0\u05D9\u05DF \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA \u05D6\u05DE\u05D9\u05E0\u05D5\u05EA \u05DC\u05E0\u05D9\u05EA\u05D5\u05D7" }, 404, request);
    }
  }
  const toB64 = /* @__PURE__ */ __name((buf) => {
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }, "toB64");
  let chosen = null;
  let imgSource = null;
  for (const candidate of candidates) {
    const obj = candidate.r2_key ? await env.PHOTOS.get(candidate.r2_key) : null;
    if (obj && obj.size <= 4.5 * 1024 * 1024) {
      chosen = candidate;
      const mime = obj.httpMetadata?.contentType || "image/jpeg";
      imgSource = { type: "base64", media_type: mime, data: toB64(await obj.arrayBuffer()) };
      break;
    }
    const imgUrl = candidate.thumbnail || candidate.url;
    if (imgUrl) {
      if (imgUrl.startsWith("/photos/")) {
        const thumbKey = imgUrl.slice("/photos/".length);
        if (thumbKey && thumbKey !== candidate.r2_key) {
          const thumbObj = await env.PHOTOS.get(thumbKey);
          if (thumbObj && thumbObj.size <= 10 * 1024 * 1024) {
            chosen = candidate;
            const mime = thumbObj.httpMetadata?.contentType || "image/jpeg";
            imgSource = { type: "base64", media_type: mime, data: toB64(await thumbObj.arrayBuffer()) };
            break;
          }
        }
        try {
          const origin = new URL(request.url).origin;
          const resp = await fetch(`${origin}${imgUrl}`);
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            if (buf.byteLength <= 10 * 1024 * 1024) {
              chosen = candidate;
              const mime = resp.headers.get("content-type") || "image/jpeg";
              imgSource = { type: "base64", media_type: mime, data: toB64(buf) };
              break;
            }
          }
        } catch (_) {
        }
      } else {
        try {
          const resp = await fetch(imgUrl);
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            if (buf.byteLength <= 10 * 1024 * 1024) {
              chosen = candidate;
              const mime = resp.headers.get("content-type") || "image/jpeg";
              imgSource = { type: "base64", media_type: mime, data: toB64(buf) };
              break;
            }
          }
        } catch (_) {
        }
      }
    }
  }
  if (!chosen || !imgSource) {
    const dbg = candidates.map((c) => ({ id: c.id, r2: c.r2_key || null, thumb: c.thumbnail || null, url: c.url || null }));
    return jsonRes({ error: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D4 \u05EA\u05DE\u05D5\u05E0\u05D4 \u05DC\u05E0\u05D9\u05EA\u05D5\u05D7", debug: dbg }, 404, request);
  }
  const analysisRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: imgSource },
          { type: "text", text: `\u05D0\u05EA\u05D4 \u05DE\u05D5\u05E8\u05D4 \u05DC\u05E6\u05D9\u05DC\u05D5\u05DD \u05DB\u05D5\u05EA\u05D1 \u05DE\u05D3\u05E8\u05D9\u05DA \u05DC\u05E6\u05DC\u05DE\u05DF \u05DE\u05EA\u05D7\u05D9\u05DC \u05E2\u05DC \u05D4\u05EA\u05DE\u05D5\u05E0\u05D4 \u05D4\u05D6\u05D5.

\u05DB\u05D5\u05EA\u05E8\u05EA: ${chosen.title || ""}
\u05EA\u05D9\u05D0\u05D5\u05E8: ${chosen.description || ""}

\u05D1\u05D7\u05E8 \u05D0\u05EA \u05D7\u05D5\u05E7 \u05D4\u05E6\u05D9\u05DC\u05D5\u05DD \u05E9\u05D4\u05EA\u05DE\u05D5\u05E0\u05D4 \u05DE\u05D3\u05D2\u05D9\u05DE\u05D4 \u05D4\u05DB\u05D9 \u05D1\u05E8\u05D5\u05E8 \u05DE\u05EA\u05D5\u05DA: rule_of_thirds, symmetry, leading_lines, golden_ratio, framing, negative_space

\u05E0\u05EA\u05D7 \u05D0\u05EA \u05D4\u05EA\u05DE\u05D5\u05E0\u05D4 \u05D5\u05D4\u05E2\u05E8\u05D9\u05DA \u05D0\u05EA \u05D4\u05D2\u05D3\u05E8\u05D5\u05EA \u05D4\u05DE\u05E6\u05DC\u05DE\u05D4 \u05D4\u05E1\u05D1\u05D9\u05E8\u05D5\u05EA \u05D1\u05D9\u05D5\u05EA\u05E8 \u05DC\u05E4\u05D9 \u05DE\u05D4 \u05E9\u05E0\u05D9\u05EA\u05DF \u05DC\u05E8\u05D0\u05D5\u05EA \u05D1\u05E4\u05D5\u05E2\u05DC \u2014 \u05D4\u05EA\u05D7\u05E9\u05D1 \u05D1\u05DB\u05DC \u05D0\u05E8\u05D1\u05E2\u05EA \u05D4\u05E4\u05E8\u05DE\u05D8\u05E8\u05D9\u05DD: \u05D7\u05E9\u05D9\u05E4\u05D4, \u05EA\u05E0\u05D5\u05E2\u05D4, \u05E8\u05E2\u05E9, \u05DE\u05E8\u05D7\u05E7 \u05E6\u05D9\u05DC\u05D5\u05DD.

\u05D4\u05D7\u05D6\u05E8 JSON \u05D1\u05DC\u05D1\u05D3 (\u05DC\u05DC\u05D0 markdown), \u05D1\u05D3\u05D9\u05D5\u05E7 \u05D1\u05DE\u05D1\u05E0\u05D4 \u05D4\u05D6\u05D4:
{
  "composition_rule": "\u05E9\u05DD_\u05D4\u05D7\u05D5\u05E7",
  "annotations": [
    {"x_pct": 0-100, "y_pct": 0-100, "label": "\u05E9\u05D5\u05E8\u05D41\\n\u05E9\u05D5\u05E8\u05D42", "anchor": "left|right|top|bottom"}
  ],
  "camera_analysis": {
    "aperture": {"value": "f/X.X", "explanation": "\u05D4\u05E1\u05D1\u05E8 \u05E7\u05E6\u05E8 \u05D1\u05E2\u05D1\u05E8\u05D9\u05EA \u2014 \u05DE\u05D4 \u05D4\u05E6\u05DE\u05E6\u05DD \u05D4\u05D6\u05D4 \u05DE\u05E9\u05D9\u05D2 \u05D1\u05EA\u05DE\u05D5\u05E0\u05D4 \u05D4\u05E1\u05E4\u05E6\u05D9\u05E4\u05D9\u05EA \u05D4\u05D6\u05D5 (\u05DC\u05D0 \u05EA\u05DE\u05D9\u05D3 \u05D1\u05D5\u05E7\u05D4 \u2014 \u05D0\u05DD \u05D4\u05DB\u05DC \u05D7\u05D3, \u05D4\u05E1\u05D1\u05E8 \u05DC\u05DE\u05D4 \u05E6\u05DE\u05E6\u05DD \u05E1\u05D2\u05D5\u05E8)"},
    "shutter":  {"value": "1/XXXs", "explanation": "\u05D4\u05E1\u05D1\u05E8 \u05E7\u05E6\u05E8 \u05D1\u05E2\u05D1\u05E8\u05D9\u05EA"},
    "iso":      {"value": "XXX",    "explanation": "\u05D4\u05E1\u05D1\u05E8 \u05E7\u05E6\u05E8 \u05D1\u05E2\u05D1\u05E8\u05D9\u05EA"},
    "focal":    {"value": "XXXmm",  "explanation": "\u05D4\u05E1\u05D1\u05E8 \u05E7\u05E6\u05E8 \u05D1\u05E2\u05D1\u05E8\u05D9\u05EA"}
  },
  "composition_html": "<p><strong>\u05DB\u05D5\u05EA\u05E8\u05EA:</strong> \u05D8\u05E7\u05E1\u05D8 \u05E8\u05D0\u05E9\u05D5\u05DF...</p><p><strong>\u05DB\u05D5\u05EA\u05E8\u05EA:</strong> \u05D8\u05E7\u05E1\u05D8 \u05E9\u05E0\u05D9...</p><p><strong>\u05DB\u05D5\u05EA\u05E8\u05EA:</strong> \u05D8\u05E7\u05E1\u05D8 \u05E9\u05DC\u05D9\u05E9\u05D9...</p>",
  "tags": ["\u05EA\u05D21", "\u05EA\u05D22", "\u05EA\u05D23", "\u05EA\u05D24"]
}

\u05D7\u05D5\u05E7\u05D9\u05DD:
- annotations: 3-5 \u05E0\u05E7\u05D5\u05D3\u05D5\u05EA \u05E9\u05DE\u05D3\u05D2\u05D9\u05DE\u05D5\u05EA \u05D0\u05EA \u05D7\u05D5\u05E7 \u05D4\u05E6\u05D9\u05DC\u05D5\u05DD. \u05D1-leading_lines: \u05D6\u05D4\u05D4 \u05D0\u05EA \u05E0\u05E7\u05D5\u05D3\u05EA \u05D4\u05DE\u05D2\u05D5\u05D6 \u2014 \u05D4\u05E0\u05E7\u05D5\u05D3\u05D4 \u05E9\u05D0\u05DC\u05D9\u05D4 \u05DE\u05EA\u05DB\u05E0\u05E1\u05D9\u05DD \u05DB\u05DC \u05E7\u05D5\u05D5\u05D9 \u05D4\u05E4\u05E8\u05E1\u05E4\u05E7\u05D8\u05D9\u05D1\u05D4 \u05D1\u05EA\u05DE\u05D5\u05E0\u05D4 (\u05E7\u05D5 \u05D2\u05D2, \u05E7\u05D5 \u05DE\u05D3\u05E8\u05DB\u05D4, \u05E7\u05D5 \u05EA\u05D7\u05EA\u05D9\u05EA \u05D1\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD). \u05D1\u05E6\u05D9\u05DC\u05D5\u05DD \u05E8\u05D7\u05D5\u05D1 \u05D4\u05D9\u05D0 \u05EA\u05DE\u05D9\u05D3 \u05D1\u05D2\u05D5\u05D1\u05D4 \u05D4\u05E2\u05D9\u05E0\u05D9\u05D9\u05DD \u2014 y_pct \u05D1\u05D9\u05DF 40-60%, \u05DC\u05D0 \u05D1\u05D7\u05DC\u05E7 \u05D4\u05E2\u05DC\u05D9\u05D5\u05DF \u05D0\u05D5 \u05D4\u05EA\u05D7\u05EA\u05D5\u05DF. \u05D4\u05D5\u05E1\u05E3 \u05D0\u05D5\u05EA\u05D4 \u05DB\u05E0\u05E7\u05D5\u05D3\u05D4 \u05E2\u05DD label "\u05E0\u05E7\u05D5\u05D3\u05EA \u05DE\u05D2\u05D5\u05D6", \u05D5\u05D4\u05E9\u05D0\u05E8 2-3 \u05E0\u05E7\u05D5\u05D3\u05D5\u05EA \u05E2\u05DC \u05D0\u05DC\u05DE\u05E0\u05D8\u05D9\u05DD \u05D7\u05E9\u05D5\u05D1\u05D9\u05DD. \u05D4\u05E7\u05D5\u05D3 \u05D9\u05E6\u05D9\u05D9\u05E8 \u05D0\u05EA \u05E7\u05D5\u05D5\u05D9 \u05D4\u05E4\u05E8\u05E1\u05E4\u05E7\u05D8\u05D9\u05D1\u05D4 \u05D0\u05D5\u05D8\u05D5\u05DE\u05D8\u05D9\u05EA. \u05D1\u05D7\u05D5\u05E7\u05D9\u05DD \u05D0\u05D7\u05E8\u05D9\u05DD: \u05E0\u05E7\u05D5\u05D3\u05D5\u05EA \u05E2\u05DC \u05D0\u05DC\u05DE\u05E0\u05D8\u05D9\u05DD \u05E8\u05DC\u05D5\u05D5\u05E0\u05D8\u05D9\u05D9\u05DD
- composition_html: \u05D1\u05D3\u05D9\u05D5\u05E7 3 \u05E4\u05E1\u05E7\u05D0\u05D5\u05EA \u05E2\u05DD <strong> \u05D1\u05EA\u05D7\u05D9\u05DC\u05EA \u05DB\u05DC \u05D0\u05D7\u05EA \u2014 \u05E4\u05E1\u05E7\u05D4 1: \u05DE\u05D4 \u05D7\u05D5\u05E7 \u05D4\u05E7\u05D5\u05DE\u05E4\u05D5\u05D6\u05D9\u05E6\u05D9\u05D4 \u05D5\u05D0\u05D9\u05DA \u05D4\u05D5\u05D0 \u05DE\u05D5\u05E4\u05D9\u05E2 \u05D1\u05EA\u05DE\u05D5\u05E0\u05D4 \u05D4\u05D6\u05D5 \u05E1\u05E4\u05E6\u05D9\u05E4\u05D9\u05EA; \u05E4\u05E1\u05E7\u05D4 2: \u05DE\u05D4 \u05E2\u05D5\u05D3 \u05DE\u05E2\u05E0\u05D9\u05D9\u05DF \u05D1\u05EA\u05DE\u05D5\u05E0\u05D4 \u05DE\u05D1\u05D7\u05D9\u05E0\u05D4 \u05D5\u05D9\u05D6\u05D5\u05D0\u05DC\u05D9\u05EA; \u05E4\u05E1\u05E7\u05D4 3: \u05DE\u05D4 \u05D4\u05E6\u05DC\u05DE\u05DF \u05D4\u05DE\u05EA\u05D7\u05D9\u05DC \u05D9\u05DB\u05D5\u05DC \u05DC\u05DC\u05DE\u05D5\u05D3 \u05DE\u05D6\u05D4
- tags: 4-6 \u05DE\u05D9\u05DC\u05D9\u05DD \u05E7\u05E6\u05E8\u05D5\u05EA \u05D1\u05E2\u05D1\u05E8\u05D9\u05EA
- \u05D4\u05DB\u05DC \u05D1\u05E2\u05D1\u05E8\u05D9\u05EA` }
        ]
      }]
    })
  });
  if (!analysisRes.ok) {
    const analysisErr = await analysisRes.text().catch(() => "");
    return jsonRes({ error: `Claude API error (analysis) ${analysisRes.status}: ${analysisErr.slice(0, 300)}` }, 502, request);
  }
  let analysis;
  try {
    const analysisJson = await analysisRes.json();
    const raw = analysisJson.content?.[0]?.text?.trim() || "{}";
    analysis = JSON.parse(raw.replace(/```json\n?|\n?```/g, ""));
  } catch (e) {
    return jsonRes({ error: "Failed to parse Claude response: " + String(e) }, 502, request);
  }
  const rule = analysis.composition_rule || "rule_of_thirds";
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(`
    INSERT OR REPLACE INTO photo_analyses
      (photo_id, composition_rule, annotations_json, camera_json, composition_html, tags_json, title, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    chosen.id,
    rule,
    JSON.stringify(analysis.annotations || []),
    JSON.stringify(analysis.camera_analysis || {}),
    analysis.composition_html || "",
    JSON.stringify(analysis.tags || []),
    chosen.title || "",
    now
  ).run();
  return jsonRes({
    ok: true,
    photo_id: chosen.id,
    title: chosen.title,
    thumbnail: chosen.thumbnail || chosen.url,
    composition_rule: rule,
    tags: analysis.tags || [],
    composition_html: analysis.composition_html || "",
    learn_url: `https://amitphotos.com/learn/${chosen.id}`
  }, 200, request);
}
__name(handleAnalysesGenerate, "handleAnalysesGenerate");
var RULE_LABELS = {
  rule_of_thirds: "\u05D7\u05D5\u05E7 \u05D4\u05E9\u05DC\u05D9\u05E9",
  symmetry: "\u05E1\u05D9\u05DE\u05D8\u05E8\u05D9\u05D4",
  leading_lines: "\u05E7\u05D5\u05D5\u05D9\u05DD \u05DE\u05D5\u05D1\u05D9\u05DC\u05D9\u05DD",
  golden_ratio: "\u05D9\u05D7\u05E1 \u05D4\u05D6\u05D4\u05D1",
  framing: "\u05DE\u05E1\u05D2\u05D5\u05E8",
  negative_space: "\u05DE\u05E8\u05D7\u05D1 \u05E9\u05DC\u05D9\u05DC\u05D9"
};
var RULE_LABELS_EN = {
  rule_of_thirds: "Rule of Thirds",
  symmetry: "Symmetry",
  leading_lines: "Leading Lines",
  golden_ratio: "Golden Ratio",
  framing: "Framing",
  negative_space: "Negative Space"
};
async function handleLearnIndex(env) {
  try {
    await env.DB.prepare("ALTER TABLE photo_analyses ADD COLUMN tags_json_en TEXT DEFAULT '[]'").run();
  } catch (_) {
  }
  const { results: analyses } = await env.DB.prepare(
    `SELECT a.photo_id, a.title, a.title_en, a.composition_rule, a.tags_json, a.tags_json_en, a.published_at,
            p.thumbnail
     FROM photo_analyses a
     LEFT JOIN photos p ON p.id = a.photo_id
     ORDER BY a.published_at DESC`
  ).all().catch(() => ({ results: [] }));
  const cards = (analyses || []).map((a) => {
    const thumb = a.thumbnail || "";
    const ruleLabelHe = RULE_LABELS[a.composition_rule] || a.composition_rule;
    const ruleLabelEn = RULE_LABELS_EN[a.composition_rule] || a.composition_rule;
    const titleEn = a.title_en || a.title;
    const tagsHe = JSON.parse(a.tags_json || "[]").slice(0, 3);
    const tagsEn = JSON.parse(a.tags_json_en || "[]").slice(0, 3);
    const tags = tagsHe.map((t, i) => {
      const en = tagsEn[i];
      return en ? `<span class="tag"><span class="lang-he">${escXml(t)}</span><span class="lang-en" style="display:none">${escXml(en)}</span></span>` : `<span class="tag">${escXml(t)}</span>`;
    }).join("");
    const date = a.published_at ? a.published_at.slice(0, 10) : "";
    return `<a class="learn-card" href="/learn/${escXml(a.photo_id)}">
      <img src="${escXml(thumb)}" alt="${escXml(a.title)}" loading="lazy">
      <div class="learn-card-body">
        <div class="learn-card-rule" data-he="${escXml(ruleLabelHe)}" data-en="${escXml(ruleLabelEn)}">${escXml(ruleLabelHe)}</div>
        <div class="learn-card-title" data-he="${escXml(a.title)}" data-en="${escXml(titleEn)}">${escXml(a.title)}</div>
        <div class="learn-card-tags">${tags}</div>
        <div class="learn-card-date">${escXml(date)}</div>
      </div>
    </a>`;
  }).join("\n");
  const empty = analyses.length === 0 ? '<p style="text-align:center;color:#888;padding:4rem" data-he="\u05D4\u05E0\u05D9\u05EA\u05D5\u05D7 \u05D4\u05E8\u05D0\u05E9\u05D5\u05DF \u05D9\u05E4\u05D5\u05E8\u05E1\u05DD \u05D1\u05E7\u05E8\u05D5\u05D1 \u2014 \u05D7\u05D6\u05E8\u05D5 \u05DE\u05D7\u05E8!" data-en="First analysis coming soon \u2014 check back tomorrow!">\u05D4\u05E0\u05D9\u05EA\u05D5\u05D7 \u05D4\u05E8\u05D0\u05E9\u05D5\u05DF \u05D9\u05E4\u05D5\u05E8\u05E1\u05DD \u05D1\u05E7\u05E8\u05D5\u05D1 \u2014 \u05D7\u05D6\u05E8\u05D5 \u05DE\u05D7\u05E8!</p>' : "";
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>\u05E0\u05D9\u05EA\u05D5\u05D7 \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA \u2014 Amit Photos</title>
<meta name="description" content="\u05E0\u05D9\u05EA\u05D5\u05D7 \u05E6\u05D9\u05DC\u05D5\u05DE\u05D9 \u05DE\u05E2\u05DE\u05D9\u05E7 \u05E9\u05DC \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA \u05D0\u05DE\u05E0\u05D5\u05EA \u2014 \u05D7\u05D5\u05E7 \u05D4\u05E9\u05DC\u05D9\u05E9, \u05D1\u05D5\u05E7\u05D4, \u05E7\u05D5\u05DE\u05E4\u05D5\u05D6\u05D9\u05E6\u05D9\u05D4. \u05DE\u05D3\u05E8\u05D9\u05DA \u05DC\u05E6\u05DC\u05DE\u05DF \u05DE\u05EA\u05D7\u05D9\u05DC.">
<meta property="og:title" content="\u{1F4F8} \u05E0\u05D9\u05EA\u05D5\u05D7 \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA | Amit Photos">
<meta property="og:description" content="\u05E0\u05D9\u05EA\u05D5\u05D7 \u05E6\u05D9\u05DC\u05D5\u05DE\u05D9 \u05DE\u05E2\u05DE\u05D9\u05E7 \u2014 \u05D7\u05D5\u05E7\u05D9 \u05E7\u05D5\u05DE\u05E4\u05D5\u05D6\u05D9\u05E6\u05D9\u05D4, \u05D4\u05D2\u05D3\u05E8\u05D5\u05EA \u05DE\u05E6\u05DC\u05DE\u05D4, \u05D5\u05E4\u05D9\u05E8\u05D5\u05E9 \u05DB\u05DC \u05D1\u05D7\u05D9\u05E8\u05D4 \u05E9\u05DC \u05D4\u05E6\u05DC\u05DD.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://amitphotos.com/learn/">
<meta property="og:locale" content="he_IL">
<link rel="canonical" href="https://amitphotos.com/learn/">
${GA_SNIPPET}
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
.learn-affiliate{max-width:900px;margin:1rem auto;padding:0 1.25rem}
.learn-affiliate-inner{background:linear-gradient(135deg,rgba(200,169,110,.08),rgba(200,169,110,.03));border:1px solid rgba(200,169,110,.3);border-radius:14px;padding:1.1rem 1.4rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.learn-affiliate-text{}
.learn-affiliate-title{font-family:'Syne',sans-serif;font-size:.9rem;color:var(--accent);margin-bottom:.25rem}
.learn-affiliate-desc{font-size:.78rem;color:var(--muted)}
.learn-affiliate-btn{flex-shrink:0;background:var(--accent);color:#000;font-weight:700;font-size:.8rem;padding:.5rem 1.1rem;border-radius:8px;text-decoration:none;white-space:nowrap;transition:background .15s}
.learn-affiliate-btn:hover{background:#e0c080}
</style>
<script src="/assets/js/nav.js" defer><\/script>
<script src="/assets/js/share.js" defer><\/script>
</head>
<body>
<div class="page-hero">
  <h1 data-he="\u{1F4F8} \u05E0\u05D9\u05EA\u05D5\u05D7 \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA" data-en="\u{1F4F8} Photo Analysis">\u{1F4F8} \u05E0\u05D9\u05EA\u05D5\u05D7 \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA</h1>
  <p data-he="\u05E0\u05D9\u05EA\u05D5\u05D7 \u05E6\u05D9\u05DC\u05D5\u05DE\u05D9 \u05DE\u05E2\u05DE\u05D9\u05E7 \u2014 \u05D7\u05D5\u05E7\u05D9 \u05E7\u05D5\u05DE\u05E4\u05D5\u05D6\u05D9\u05E6\u05D9\u05D4, \u05D4\u05D2\u05D3\u05E8\u05D5\u05EA \u05DE\u05E6\u05DC\u05DE\u05D4, \u05D5\u05DE\u05D4 \u05D4\u05E6\u05DC\u05DD \u05D7\u05E9\u05D1" data-en="Deep photographic analysis \u2014 composition rules, camera settings, and the photographer's vision">\u05E0\u05D9\u05EA\u05D5\u05D7 \u05E6\u05D9\u05DC\u05D5\u05DE\u05D9 \u05DE\u05E2\u05DE\u05D9\u05E7 \u2014 \u05D7\u05D5\u05E7\u05D9 \u05E7\u05D5\u05DE\u05E4\u05D5\u05D6\u05D9\u05E6\u05D9\u05D4, \u05D4\u05D2\u05D3\u05E8\u05D5\u05EA \u05DE\u05E6\u05DC\u05DE\u05D4, \u05D5\u05DE\u05D4 \u05D4\u05E6\u05DC\u05DD \u05D7\u05E9\u05D1</p>
</div>
<div class="grid">${cards}${empty}</div>
<div class="learn-affiliate">
  <div class="learn-affiliate-inner">
    <div class="learn-affiliate-text">
      <div class="learn-affiliate-title" data-he="\u05E8\u05D5\u05E6\u05D4 \u05DC\u05E2\u05E8\u05D5\u05DA \u05DB\u05DE\u05D5 \u05D4\u05E6\u05DC\u05DE\u05D9\u05DD \u05E9\u05E0\u05D9\u05EA\u05D7\u05EA?" data-en="Want to edit like the photographers you just analyzed?">\u05E8\u05D5\u05E6\u05D4 \u05DC\u05E2\u05E8\u05D5\u05DA \u05DB\u05DE\u05D5 \u05D4\u05E6\u05DC\u05DE\u05D9\u05DD \u05E9\u05E0\u05D9\u05EA\u05D7\u05EA?</div>
      <div class="learn-affiliate-desc" data-he="Luminar Neo \u2014 \u05E2\u05E8\u05D9\u05DB\u05EA AI \u05D7\u05DB\u05DE\u05D4, \u05DE\u05D5\u05E6\u05E8 \u05DE\u05E6\u05D5\u05D9\u05DF \u05DC\u05DE\u05EA\u05D7\u05D9\u05DC\u05D9\u05DD \u05D5\u05DC\u05DE\u05E7\u05E6\u05D5\u05E2\u05E0\u05D9\u05DD" data-en="Luminar Neo \u2014 smart AI editing, great for beginners and pros alike">Luminar Neo \u2014 \u05E2\u05E8\u05D9\u05DB\u05EA AI \u05D7\u05DB\u05DE\u05D4, \u05DE\u05D5\u05E6\u05E8 \u05DE\u05E6\u05D5\u05D9\u05DF \u05DC\u05DE\u05EA\u05D7\u05D9\u05DC\u05D9\u05DD \u05D5\u05DC\u05DE\u05E7\u05E6\u05D5\u05E2\u05E0\u05D9\u05DD</div>
    </div>
    <a class="learn-affiliate-btn" href="https://skylum.evyy.net/c/7325979/1142920/3255" target="_blank" rel="noopener sponsored" data-he="\u05E0\u05E1\u05D4 \u05D7\u05D9\u05E0\u05DD \u2190" data-en="Try Free \u2192">\u05E0\u05E1\u05D4 \u05D7\u05D9\u05E0\u05DD \u2190</a>
  </div>
</div>
<div class="back-link nav-prev"><a href="https://amitphotos.com" data-he="\u2190 \u05DC\u05D2\u05DC\u05E8\u05D9\u05D4 \u05D4\u05DE\u05DC\u05D0\u05D4" data-en="\u2190 Back to Gallery">\u2190 \u05DC\u05D2\u05DC\u05E8\u05D9\u05D4 \u05D4\u05DE\u05DC\u05D0\u05D4</a></div>
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
<\/script>
</body>
</html>`;
  return htmlRes(html);
}
__name(handleLearnIndex, "handleLearnIndex");
function buildPhysicsDiagram(camera) {
  const gold = "#c8a96e", green = "#4ade80", muted = "#888";
  const apertureVal = parseFloat((camera.aperture?.value || "").replace("f/", ""));
  const focalVal = parseFloat((camera.focal?.value || "").replace(/[^0-9.]/g, ""));
  const shutterStr = camera.shutter?.value || "";
  let shutterSec = null;
  const m1 = shutterStr.match(/^1\/(\d+)/);
  if (m1) shutterSec = 1 / parseInt(m1[1]);
  else {
    const m2 = shutterStr.match(/^(\d*\.?\d+)/);
    if (m2) shutterSec = parseFloat(m2[1]);
  }
  if (!isNaN(apertureVal) && apertureVal <= 4) return {
    title: "\u{1F4CA} \u05E2\u05D5\u05DE\u05E7 \u05E9\u05D3\u05D4 \u05D5\u05D1\u05D5\u05E7\u05D4",
    titleEn: "\u{1F4CA} Depth of Field & Bokeh",
    svg: `<svg viewBox="0 0 500 180" style="width:100%;max-width:500px;display:block;margin:0 auto">
      <rect x="20" y="65" width="55" height="50" rx="5" fill="#1a1a1a" stroke="${gold}" stroke-width="1.5"/>
      <text x="47" y="94" text-anchor="middle" fill="${gold}" font-size="10" font-family="Heebo" data-he="\u05DE\u05E6\u05DC\u05DE\u05D4" data-en="Camera">\u05DE\u05E6\u05DC\u05DE\u05D4</text>
      <ellipse cx="75" cy="90" rx="9" ry="20" fill="#222" stroke="${gold}" stroke-width="1.5"/>
      <line x1="84" y1="72" x2="210" y2="90" stroke="rgba(200,169,110,.7)" stroke-width="1"/>
      <line x1="84" y1="90" x2="210" y2="90" stroke="rgba(200,169,110,.7)" stroke-width="1"/>
      <line x1="84" y1="108" x2="210" y2="90" stroke="rgba(200,169,110,.7)" stroke-width="1"/>
      <line x1="210" y1="0" x2="210" y2="180" stroke="${green}" stroke-width="2" stroke-dasharray="4,3"/>
      <text x="214" y="20" fill="${green}" font-size="10" font-family="Heebo" data-he="\u05E0\u05D5\u05E9\u05D0 (\u05D7\u05D3)" data-en="Subject (Sharp)">\u05E0\u05D5\u05E9\u05D0 (\u05D7\u05D3)</text>
      <circle cx="210" cy="90" r="5" fill="${green}"/>
      <line x1="210" y1="90" x2="410" y2="50" stroke="rgba(136,136,136,.5)" stroke-width="1"/>
      <line x1="210" y1="90" x2="410" y2="90" stroke="rgba(136,136,136,.5)" stroke-width="1"/>
      <line x1="210" y1="90" x2="410" y2="130" stroke="rgba(136,136,136,.5)" stroke-width="1"/>
      <line x1="410" y1="0" x2="410" y2="180" stroke="${muted}" stroke-width="1.5" stroke-dasharray="4,3"/>
      <text x="414" y="20" fill="${muted}" font-size="10" font-family="Heebo" data-he="\u05E8\u05E7\u05E2 (\u05DE\u05D8\u05D5\u05E9\u05D8\u05E9)" data-en="Background (Blurred)">\u05E8\u05E7\u05E2 (\u05DE\u05D8\u05D5\u05E9\u05D8\u05E9)</text>
      <circle cx="410" cy="50" r="16" fill="none" stroke="rgba(200,169,110,.4)" stroke-width="1.5"/>
      <circle cx="410" cy="90" r="16" fill="none" stroke="rgba(200,169,110,.4)" stroke-width="1.5"/>
      <circle cx="410" cy="130" r="16" fill="none" stroke="rgba(200,169,110,.4)" stroke-width="1.5"/>
      <text x="75" y="158" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="\u05E4\u05EA\u05D7 \u05E2\u05D3\u05E9\u05D4 \u05E8\u05D7\u05D1 = \u05E2\u05D5\u05DE\u05E7 \u05E9\u05D3\u05D4 \u05E8\u05D3\u05D5\u05D3 = \u05D1\u05D5\u05E7\u05D4" data-en="Wide open aperture = Shallow DOF = Bokeh">\u05E4\u05EA\u05D7 \u05E2\u05D3\u05E9\u05D4 \u05E8\u05D7\u05D1 = \u05E2\u05D5\u05DE\u05E7 \u05E9\u05D3\u05D4 \u05E8\u05D3\u05D5\u05D3 = \u05D1\u05D5\u05E7\u05D4</text>
    </svg>`
  };
  if (!isNaN(focalVal) && focalVal <= 28) return {
    title: "\u{1F4CA} \u05D6\u05D5\u05D5\u05D9\u05EA \u05E8\u05D7\u05D1\u05D4 \u05D5\u05E4\u05E8\u05E1\u05E4\u05E7\u05D8\u05D9\u05D1\u05D4",
    titleEn: "\u{1F4CA} Wide Angle & Perspective",
    svg: `<svg viewBox="0 0 500 180" style="width:100%;max-width:500px;display:block;margin:0 auto">
      <rect x="10" y="70" width="48" height="40" rx="5" fill="#1a1a1a" stroke="${gold}" stroke-width="1.5"/>
      <text x="34" y="93" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="\u05DE\u05E6\u05DC\u05DE\u05D4" data-en="Camera">\u05DE\u05E6\u05DC\u05DE\u05D4</text>
      <text x="34" y="105" text-anchor="middle" fill="${gold}" font-size="8" font-family="Heebo">${focalVal}mm</text>
      <line x1="58" y1="90" x2="470" y2="15"  stroke="rgba(200,169,110,.5)" stroke-width="1.5" stroke-dasharray="4,3"/>
      <line x1="58" y1="90" x2="470" y2="165" stroke="rgba(200,169,110,.5)" stroke-width="1.5" stroke-dasharray="4,3"/>
      <rect x="100" y="52" width="18" height="76" rx="3" fill="${green}" opacity="0.85"/>
      <text x="109" y="143" text-anchor="middle" fill="${green}" font-size="9" font-family="Heebo" data-he="\u05E7\u05E8\u05D5\u05D1" data-en="Near">\u05E7\u05E8\u05D5\u05D1</text>
      <rect x="240" y="72" width="12" height="36" rx="2" fill="${gold}" opacity="0.65"/>
      <text x="246" y="122" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="\u05D1\u05D9\u05E0\u05D9\u05D9\u05DD" data-en="Mid">\u05D1\u05D9\u05E0\u05D9\u05D9\u05DD</text>
      <rect x="370" y="83" width="7" height="14" rx="2" fill="${muted}" opacity="0.7"/>
      <text x="374" y="108" text-anchor="middle" fill="${muted}" font-size="9" font-family="Heebo" data-he="\u05E8\u05D7\u05D5\u05E7" data-en="Far">\u05E8\u05D7\u05D5\u05E7</text>
      <line x1="100" y1="52"  x2="378" y2="81"  stroke="rgba(200,169,110,.3)" stroke-width="1"/>
      <line x1="118" y1="128" x2="378" y2="97" stroke="rgba(200,169,110,.3)" stroke-width="1"/>
      <text x="250" y="170" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="\u05E9\u05D3\u05D4 \u05E8\u05D0\u05D9\u05D9\u05D4 \u05E8\u05D7\u05D1 \u2014 \u05E7\u05E8\u05D5\u05D1 \u05E0\u05E8\u05D0\u05D4 \u05D2\u05D3\u05D5\u05DC, \u05E8\u05D7\u05D5\u05E7 \u05E7\u05D8\u05DF \u2192 \u05E2\u05D5\u05DE\u05E7 \u05D3\u05E8\u05DE\u05D8\u05D9" data-en="Wide field of view \u2014 near appears large, far small \u2192 dramatic depth">\u05E9\u05D3\u05D4 \u05E8\u05D0\u05D9\u05D9\u05D4 \u05E8\u05D7\u05D1 \u2014 \u05E7\u05E8\u05D5\u05D1 \u05E0\u05E8\u05D0\u05D4 \u05D2\u05D3\u05D5\u05DC, \u05E8\u05D7\u05D5\u05E7 \u05E7\u05D8\u05DF \u2192 \u05E2\u05D5\u05DE\u05E7 \u05D3\u05E8\u05DE\u05D8\u05D9</text>
    </svg>`
  };
  if (!isNaN(focalVal) && focalVal >= 85) return {
    title: "\u{1F4CA} \u05D3\u05D7\u05D9\u05E1\u05EA \u05D8\u05DC\u05D4",
    titleEn: "\u{1F4CA} Telephoto Compression",
    svg: `<svg viewBox="0 0 500 180" style="width:100%;max-width:500px;display:block;margin:0 auto">
      <rect x="10" y="70" width="55" height="40" rx="5" fill="#1a1a1a" stroke="${gold}" stroke-width="1.5"/>
      <text x="37" y="93" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="\u05DE\u05E6\u05DC\u05DE\u05D4" data-en="Camera">\u05DE\u05E6\u05DC\u05DE\u05D4</text>
      <text x="37" y="105" text-anchor="middle" fill="${gold}" font-size="8" font-family="Heebo">${focalVal}mm</text>
      <line x1="65" y1="90" x2="460" y2="68"  stroke="rgba(200,169,110,.5)" stroke-width="1.5" stroke-dasharray="4,3"/>
      <line x1="65" y1="90" x2="460" y2="112" stroke="rgba(200,169,110,.5)" stroke-width="1.5" stroke-dasharray="4,3"/>
      <rect x="210" y="72" width="16" height="36" rx="3" fill="${green}" opacity="0.85"/>
      <text x="218" y="122" text-anchor="middle" fill="${green}" font-size="9" font-family="Heebo" data-he="\u05E7\u05E8\u05D5\u05D1" data-en="Near">\u05E7\u05E8\u05D5\u05D1</text>
      <rect x="320" y="74" width="14" height="32" rx="3" fill="${gold}" opacity="0.7"/>
      <text x="327" y="120" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="\u05E8\u05D7\u05D5\u05E7" data-en="Far">\u05E8\u05D7\u05D5\u05E7</text>
      <line x1="226" y1="90" x2="318" y2="90" stroke="rgba(200,169,110,.5)" stroke-width="1.5" stroke-dasharray="3,2"/>
      <text x="272" y="84" text-anchor="middle" fill="${muted}" font-size="9" font-family="Heebo" data-he="\u05E0\u05E8\u05D0\u05D9\u05DD \u05E7\u05E8\u05D5\u05D1\u05D9\u05DD" data-en="Appear close">\u05E0\u05E8\u05D0\u05D9\u05DD \u05E7\u05E8\u05D5\u05D1\u05D9\u05DD</text>
      <text x="260" y="170" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="\u05E9\u05D3\u05D4 \u05E8\u05D0\u05D9\u05D9\u05D4 \u05E6\u05E8 \u2014 \u05DE\u05E8\u05D7\u05E7\u05D9\u05DD \u05E0\u05D3\u05D7\u05E1\u05D9\u05DD, \u05E8\u05E7\u05E2 \u05E0\u05E8\u05D0\u05D4 \u05E7\u05E8\u05D5\u05D1 \u05D9\u05D5\u05EA\u05E8" data-en="Narrow field of view \u2014 distances compressed, background appears closer">\u05E9\u05D3\u05D4 \u05E8\u05D0\u05D9\u05D9\u05D4 \u05E6\u05E8 \u2014 \u05DE\u05E8\u05D7\u05E7\u05D9\u05DD \u05E0\u05D3\u05D7\u05E1\u05D9\u05DD, \u05E8\u05E7\u05E2 \u05E0\u05E8\u05D0\u05D4 \u05E7\u05E8\u05D5\u05D1 \u05D9\u05D5\u05EA\u05E8</text>
    </svg>`
  };
  if (shutterSec !== null && shutterSec >= 1 / 30) return {
    title: "\u{1F4CA} \u05D7\u05E9\u05D9\u05E4\u05D4 \u05D0\u05E8\u05D5\u05DB\u05D4 \u05D5\u05EA\u05E0\u05D5\u05E2\u05D4",
    titleEn: "\u{1F4CA} Long Exposure & Motion",
    svg: `<svg viewBox="0 0 500 180" style="width:100%;max-width:500px;display:block;margin:0 auto">
      <rect x="20" y="70" width="50" height="40" rx="5" fill="#1a1a1a" stroke="${gold}" stroke-width="1.5"/>
      <text x="45" y="93" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="\u05DE\u05E6\u05DC\u05DE\u05D4" data-en="Camera">\u05DE\u05E6\u05DC\u05DE\u05D4</text>
      <text x="45" y="105" text-anchor="middle" fill="${gold}" font-size="8" font-family="Heebo">${shutterStr}</text>
      <rect x="200" y="58" width="18" height="64" rx="3" fill="${green}" opacity="0.9"/>
      <text x="209" y="136" text-anchor="middle" fill="${green}" font-size="9" font-family="Heebo" data-he="\u05E0\u05D9\u05D9\u05D7 (\u05D7\u05D3)" data-en="Stationary (Sharp)">\u05E0\u05D9\u05D9\u05D7 (\u05D7\u05D3)</text>
      <ellipse cx="370" cy="90" rx="65" ry="14" fill="rgba(200,169,110,.18)" stroke="rgba(200,169,110,.35)" stroke-width="1"/>
      <ellipse cx="335" cy="90" rx="14" ry="14" fill="rgba(200,169,110,.55)"/>
      <text x="370" y="118" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="\u05E0\u05E2 (\u05DE\u05D8\u05D5\u05E9\u05D8\u05E9)" data-en="Moving (Blurred)">\u05E0\u05E2 (\u05DE\u05D8\u05D5\u05E9\u05D8\u05E9)</text>
      <line x1="200" y1="158" x2="430" y2="158" stroke="${muted}" stroke-width="1.5"/>
      <polygon points="430,154 440,158 430,162" fill="${muted}"/>
      <text x="315" y="172" text-anchor="middle" fill="${muted}" font-size="9" font-family="Heebo" data-he="\u05D6\u05DE\u05DF \u05D7\u05E9\u05D9\u05E4\u05D4" data-en="Exposure Time">\u05D6\u05DE\u05DF \u05D7\u05E9\u05D9\u05E4\u05D4</text>
      <text x="250" y="22" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="\u05E9\u05D0\u05D8\u05E8 \u05E4\u05EA\u05D5\u05D7 \u05D6\u05DE\u05DF \u05E8\u05D1 \u2192 \u05EA\u05E0\u05D5\u05E2\u05D4 \u05E0\u05E8\u05E9\u05DE\u05EA \u05DB\u05D8\u05E9\u05D8\u05D5\u05E9" data-en="Long shutter \u2192 motion recorded as blur">\u05E9\u05D0\u05D8\u05E8 \u05E4\u05EA\u05D5\u05D7 \u05D6\u05DE\u05DF \u05E8\u05D1 \u2192 \u05EA\u05E0\u05D5\u05E2\u05D4 \u05E0\u05E8\u05E9\u05DE\u05EA \u05DB\u05D8\u05E9\u05D8\u05D5\u05E9</text>
    </svg>`
  };
  if (shutterSec !== null && shutterSec <= 1 / 500) return {
    title: "\u{1F4CA} \u05D4\u05E7\u05E4\u05D0\u05EA \u05EA\u05E0\u05D5\u05E2\u05D4",
    titleEn: "\u{1F4CA} Freezing Motion",
    svg: `<svg viewBox="0 0 500 180" style="width:100%;max-width:500px;display:block;margin:0 auto">
      <rect x="20" y="70" width="50" height="40" rx="5" fill="#1a1a1a" stroke="${gold}" stroke-width="1.5"/>
      <text x="45" y="93" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="\u05DE\u05E6\u05DC\u05DE\u05D4" data-en="Camera">\u05DE\u05E6\u05DC\u05DE\u05D4</text>
      <text x="45" y="105" text-anchor="middle" fill="${gold}" font-size="8" font-family="Heebo">${shutterStr}</text>
      <line x1="185" y1="90" x2="270" y2="90" stroke="rgba(200,169,110,.3)" stroke-width="6" stroke-linecap="round"/>
      <polygon points="272,85 282,90 272,95" fill="rgba(200,169,110,.4)"/>
      <text x="228" y="60" text-anchor="middle" fill="${muted}" font-size="9" font-family="Heebo" data-he="\u05DB\u05D9\u05D5\u05D5\u05DF \u05EA\u05E0\u05D5\u05E2\u05D4" data-en="Motion direction">\u05DB\u05D9\u05D5\u05D5\u05DF \u05EA\u05E0\u05D5\u05E2\u05D4</text>
      <circle cx="330" cy="90" r="22" fill="none" stroke="${gold}" stroke-width="2"/>
      <circle cx="330" cy="90" r="6"  fill="${gold}"/>
      <text x="330" y="128" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="\u05E7\u05E4\u05D5\u05D0 \u05D1\u05E8\u05D2\u05E2" data-en="Frozen in moment">\u05E7\u05E4\u05D5\u05D0 \u05D1\u05E8\u05D2\u05E2</text>
      <text x="260" y="170" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="\u05E9\u05D0\u05D8\u05E8 \u05DE\u05D4\u05D9\u05E8 \u05DE\u05D0\u05D5\u05D3 = \u05EA\u05E0\u05D5\u05E2\u05D4 \u05E7\u05E4\u05D5\u05D0\u05D4 \u05DC\u05D7\u05DC\u05D5\u05D8\u05D9\u05DF" data-en="Very fast shutter = motion completely frozen">\u05E9\u05D0\u05D8\u05E8 \u05DE\u05D4\u05D9\u05E8 \u05DE\u05D0\u05D5\u05D3 = \u05EA\u05E0\u05D5\u05E2\u05D4 \u05E7\u05E4\u05D5\u05D0\u05D4 \u05DC\u05D7\u05DC\u05D5\u05D8\u05D9\u05DF</text>
    </svg>`
  };
  return {
    title: "\u{1F4CA} ISO \u05D5\u05E8\u05E2\u05E9 \u05D3\u05D9\u05D2\u05D9\u05D8\u05DC\u05D9",
    titleEn: "\u{1F4CA} ISO & Digital Noise",
    svg: `<svg viewBox="0 0 500 180" style="width:100%;max-width:500px;display:block;margin:0 auto">
      <text x="120" y="25" text-anchor="middle" fill="${green}" font-size="11" font-family="Heebo" data-he="ISO \u05E0\u05DE\u05D5\u05DA (\u05E0\u05E7\u05D9)" data-en="Low ISO (Clean)">ISO \u05E0\u05DE\u05D5\u05DA (\u05E0\u05E7\u05D9)</text>
      ${Array.from({ length: 36 }, (_, i) => `<rect x="${40 + i % 6 * 16}" y="${35 + Math.floor(i / 6) * 16}" width="13" height="13" rx="1" fill="rgba(74,222,128,.7)" stroke="rgba(74,222,128,.3)" stroke-width=".5"/>`).join("")}
      <text x="370" y="25" text-anchor="middle" fill="#ef4444" font-size="11" font-family="Heebo" data-he="ISO \u05D2\u05D1\u05D5\u05D4 (\u05E8\u05E2\u05E9)" data-en="High ISO (Noisy)">ISO \u05D2\u05D1\u05D5\u05D4 (\u05E8\u05E2\u05E9)</text>
      ${Array.from({ length: 36 }, (_, i) => {
      const c = ["rgba(239,68,68,.8)", "rgba(200,169,110,.6)", "rgba(136,136,136,.9)", "rgba(239,68,68,.4)", "rgba(74,222,128,.5)"];
      return `<rect x="${290 + i % 6 * 16}" y="${35 + Math.floor(i / 6) * 16}" width="13" height="13" rx="1" fill="${c[(i * 37 + 13) % 5]}" stroke="rgba(0,0,0,.3)" stroke-width=".5"/>`;
    }).join("")}
      <line x1="200" y1="80" x2="273" y2="80" stroke="${muted}" stroke-width="1.5"/>
      <polygon points="273,76 283,80 273,84" fill="${muted}"/>
      <text x="237" y="73" text-anchor="middle" fill="${muted}" font-size="9" font-family="Heebo" data-he="ISO \u05E2\u05D5\u05DC\u05D4" data-en="ISO increases">ISO \u05E2\u05D5\u05DC\u05D4</text>
      <text x="250" y="168" text-anchor="middle" fill="${gold}" font-size="9" font-family="Heebo" data-he="\u05E8\u05D2\u05D9\u05E9\u05D5\u05EA \u05D2\u05D1\u05D5\u05D4\u05D4 \u05DC\u05D0\u05D5\u05E8 = \u05D9\u05D5\u05EA\u05E8 \u05E8\u05E2\u05E9 \u05D1\u05E4\u05D9\u05E7\u05E1\u05DC\u05D9\u05DD" data-en="Higher light sensitivity = more pixel noise">\u05E8\u05D2\u05D9\u05E9\u05D5\u05EA \u05D2\u05D1\u05D5\u05D4\u05D4 \u05DC\u05D0\u05D5\u05E8 = \u05D9\u05D5\u05EA\u05E8 \u05E8\u05E2\u05E9 \u05D1\u05E4\u05D9\u05E7\u05E1\u05DC\u05D9\u05DD</text>
    </svg>`
  };
}
__name(buildPhysicsDiagram, "buildPhysicsDiagram");
function buildRuleOverlay(rule, annotations) {
  const red = "#e05555";
  const dash = "5,5";
  if (rule === "rule_of_thirds") return `
    <line x1="33.3%" y1="0" x2="33.3%" y2="100%" stroke="${red}" stroke-width="0.6" stroke-dasharray="${dash}" opacity="0.85"/>
    <line x1="66.6%" y1="0" x2="66.6%" y2="100%" stroke="${red}" stroke-width="0.6" stroke-dasharray="${dash}" opacity="0.85"/>
    <line x1="0" y1="33.3%" x2="100%" y2="33.3%" stroke="${red}" stroke-width="0.6" stroke-dasharray="${dash}" opacity="0.85"/>
    <line x1="0" y1="66.6%" x2="100%" y2="66.6%" stroke="${red}" stroke-width="0.6" stroke-dasharray="${dash}" opacity="0.85"/>
    <circle cx="33.3%" cy="33.3%" r="1.5" fill="${red}" opacity="0.7"/>
    <circle cx="66.6%" cy="33.3%" r="1.5" fill="${red}" opacity="0.7"/>
    <circle cx="33.3%" cy="66.6%" r="1.5" fill="${red}" opacity="0.7"/>
    <circle cx="66.6%" cy="66.6%" r="1.5" fill="${red}" opacity="0.7"/>`;
  if (rule === "symmetry") return `
    <line x1="50%" y1="0" x2="50%" y2="100%" stroke="${red}" stroke-width="0.6" stroke-dasharray="${dash}" opacity="0.85"/>`;
  if (rule === "leading_lines") {
    if (annotations.some((a) => a.type === "line" || a.type === "arrow")) return "";
    const vp = annotations.find((a) => !a.type && a.label && (a.label.includes("\u05DE\u05D2\u05D5\u05D6") || a.label.includes("\u05D4\u05EA\u05DB\u05E0\u05E1\u05D5\u05EA"))) || annotations.find((a) => !a.type);
    if (vp) {
      const vx = parseFloat(vp.x_pct) ?? 80;
      const vy = parseFloat(vp.y_pct) ?? 50;
      const fromLeft = vx >= 50;
      const sx = fromLeft ? 0 : 100;
      const lines = [-35, -12, 12, 35].map((off) => {
        const sy = Math.max(2, Math.min(98, vy + off));
        return `<line x1="${sx}%" y1="${sy}%" x2="${vx}%" y2="${vy}%" stroke="${red}" stroke-width="0.6" opacity="0.85" stroke-linecap="round"/>`;
      }).join("");
      return `<g>${lines}</g>`;
    }
    return `<g stroke="${red}" fill="${red}" opacity="0.85">
      <line x1="5%" y1="95%" x2="60%" y2="30%" stroke-width="0.6"/>
      <polygon points="60%,25% 57%,35% 63%,35%"/>
    </g>`;
  }
  if (rule === "framing") return `
    <rect x="10%" y="10%" width="80%" height="80%" fill="none" stroke="${red}" stroke-width="0.6" stroke-dasharray="${dash}" opacity="0.85"/>`;
  if (rule === "negative_space") return `
    <rect x="0" y="0" width="40%" height="100%" fill="rgba(224,85,85,0.07)"/>`;
  if (rule === "golden_ratio") {
    const g = 0.618;
    return `
    <g stroke="${red}" fill="none" stroke-width="0.6" opacity="0.85">
      <rect x="0" y="0" width="100%" height="100%" fill="none" stroke-dasharray="4,4" opacity="0.5"/>
      <line x1="${g * 100}%" y1="0" x2="${g * 100}%" y2="100%" stroke-dasharray="4,4"/>
      <path d="M ${g * 100}%,0 A ${g * 100}%,100% 0 0 0 0,100%"/>
      <path d="M 0,${g * 100}% A ${(1 - g) * 100}%,${(1 - g) * 100}% 0 0 1 ${(1 - g) * 100}%,100%"/>
      <path d="M ${(1 - g) * 100}%,${g * (1 - g) * 100}% A ${g * (1 - g) * 100}%,${g * (1 - g) * 100}% 0 0 0 0,${g * (1 - g) * 100}%"/>
    </g>`;
  }
  return "";
}
__name(buildRuleOverlay, "buildRuleOverlay");
function buildAnnotationSVGLines(annotations) {
  const lineAnns = annotations.filter((a) => a.type === "line" || a.type === "arrow");
  if (!lineAnns.length) return "";
  const gold = "#c8a96e";
  const defs = `<defs>
    <marker id="pw-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${gold}"/>
    </marker>
  </defs>`;
  const els = lineAnns.map((ann) => {
    const idx = annotations.indexOf(ann);
    const x1 = parseFloat(ann.x1_pct) || 0, y1 = parseFloat(ann.y1_pct) || 0;
    const x2 = parseFloat(ann.x2_pct) || 0, y2 = parseFloat(ann.y2_pct) || 0;
    const arrowAttr = ann.type === "arrow" ? ` marker-end="url(#pw-arr)"` : "";
    return `<line data-ann-idx="${idx}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${gold}" stroke-width="0.8" stroke-linecap="round"${arrowAttr} style="opacity:0;transition:opacity .4s"/>`;
  }).join("\n");
  return defs + els;
}
__name(buildAnnotationSVGLines, "buildAnnotationSVGLines");
function buildAnnotationLabels(annotations) {
  return annotations.filter((a) => (a.type === "line" || a.type === "arrow") && a.label).map((ann) => {
    const idx = annotations.indexOf(ann);
    const x1 = parseFloat(ann.x1_pct) || 0, y1 = parseFloat(ann.y1_pct) || 0;
    const x2 = parseFloat(ann.x2_pct) || 0, y2 = parseFloat(ann.y2_pct) || 0;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const labelContent = ann.label_en ? `<span class="lang-he">${escXml(ann.label)}</span><span class="lang-en" style="display:none">${escXml(ann.label_en)}</span>` : escXml(ann.label);
    return `<div data-ann-idx="${idx}" style="position:absolute;left:${mx}%;top:${my}%;transform:translate(-50%,-130%);background:rgba(0,0,0,.85);border:1px solid rgba(200,169,110,.4);border-radius:6px;padding:3px 8px;font-size:.68rem;color:#f0ede8;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .4s">${labelContent}</div>`;
  }).join("\n");
}
__name(buildAnnotationLabels, "buildAnnotationLabels");
function buildAnnotations(annotations) {
  return annotations.filter((a) => a.type !== "line" && a.type !== "arrow").map((ann, _) => {
    const idx = annotations.indexOf(ann);
    const x = parseFloat(ann.x_pct) || 0;
    const y = parseFloat(ann.y_pct) || 0;
    const anchorClass = `ann-${ann.anchor || "right"}`;
    const labelHe = (ann.label || "").split("\n").map((l) => escXml(l)).join("<br>");
    const labelContent = ann.label_en ? `<span class="lang-he">${labelHe}</span><span class="lang-en" style="display:none">${ann.label_en.split("\n").map((l) => escXml(l)).join("<br>")}</span>` : labelHe;
    return `<div class="ann" data-ann-idx="${idx}" style="left:${x}%;top:${y}%;opacity:0;transition:opacity .4s">
      <div class="ann-dot"></div>
      <div class="ann-label ${anchorClass}">${labelContent}</div>
    </div>`;
  }).join("\n");
}
__name(buildAnnotations, "buildAnnotations");
async function handleLearnAnalysis(env, photoId) {
  const row = await env.DB.prepare(
    "SELECT * FROM photo_analyses WHERE photo_id = ?"
  ).bind(photoId).first().catch(() => null);
  const photo = await env.DB.prepare(
    "SELECT id, title, thumbnail, url FROM photos WHERE id = ?"
  ).bind(photoId).first().catch(() => null);
  if (!row || !photo) {
    return htmlRes(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0</title><style>body{background:#0a0a0a;color:#f0ede8;font-family:'Heebo',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:1rem}</style></head><body><h1 style="color:#c8a96e;font-size:2rem">404</h1><p>\u05D4\u05E0\u05D9\u05EA\u05D5\u05D7 \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0</p><a href="/learn/" style="color:#c8a96e">\u2190 \u05D7\u05D6\u05E8\u05D4 \u05DC\u05E0\u05D9\u05EA\u05D5\u05D7 \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA</a></body></html>`, 404);
  }
  const [prevRow, nextRow, moreRows] = await Promise.all([
    env.DB.prepare(`SELECT a.photo_id, a.title, a.title_en FROM photo_analyses a WHERE a.published_at > ? AND a.published_at IS NOT NULL ORDER BY a.published_at ASC LIMIT 1`).bind(row.published_at || "").first().catch(() => null),
    env.DB.prepare(`SELECT a.photo_id, a.title, a.title_en FROM photo_analyses a WHERE a.published_at < ? AND a.published_at IS NOT NULL ORDER BY a.published_at DESC LIMIT 1`).bind(row.published_at || "").first().catch(() => null),
    env.DB.prepare(`SELECT a.photo_id, a.title, a.title_en, a.composition_rule, p.thumbnail, p.url FROM photo_analyses a LEFT JOIN photos p ON p.id = a.photo_id WHERE a.photo_id != ? AND a.published_at IS NOT NULL ORDER BY RANDOM() LIMIT 4`).bind(photoId).all().catch(() => ({ results: [] }))
  ]);
  const moreAnalyses = moreRows?.results || [];
  let annotations = [], camera = {}, cameraEn = {}, tags = [];
  try {
    annotations = JSON.parse(row.annotations_json || "[]");
  } catch (_) {
    annotations = [];
  }
  function buildAnalysisAffiliate(cam) {
    const aperture = parseFloat((cam.aperture?.value || "").replace("f/", ""));
    const focal = parseFloat((cam.focal?.value || "").replace(/[^0-9.]/g, ""));
    const shutterStr = cam.shutter?.value || "";
    const m1 = shutterStr.match(/^1\/(\d+)/);
    const m2 = shutterStr.match(/^(\d*\.?\d+)/);
    const shutterSec = m1 ? 1 / parseInt(m1[1]) : m2 ? parseFloat(m2[1]) : null;
    let link, titleHe, titleEn2, descHe, descEn, btnHe, btnEn;
    if (!isNaN(aperture) && aperture <= 2) {
      link = "https://adorama.prf.hn/click/camref:1101l5Km5i/destination:https://www.adorama.com/catalog.tpl?SearchInfo=50mm+85mm+f1.8+prime+lens";
      titleHe = "\u{1F3AF} \u05E2\u05D3\u05E9\u05EA \u05E4\u05E8\u05D9\u05D9\u05DD \u05DE\u05D4\u05D9\u05E8\u05D4 \u2014 \u05D4\u05E1\u05D5\u05D3 \u05DE\u05D0\u05D7\u05D5\u05E8\u05D9 \u05D4\u05D1\u05D5\u05E7\u05D4";
      titleEn2 = "\u{1F3AF} Fast Prime Lens \u2014 The Secret Behind the Bokeh";
      descHe = `\u05D4\u05E6\u05D9\u05DC\u05D5\u05DD \u05D4\u05D6\u05D4 \u05D1\u05D5\u05E6\u05E2 \u05E2\u05DD \u05E4\u05EA\u05D7 f/${aperture} \u2014 \u05E2\u05D3\u05E9\u05EA \u05E4\u05E8\u05D9\u05D9\u05DD \u05DE\u05D4\u05D9\u05E8\u05D4 \u05D4\u05D9\u05D0 \u05D4\u05D4\u05E9\u05E7\u05E2\u05D4 \u05E9\u05DE\u05E9\u05E4\u05E8\u05EA \u05D9\u05D5\u05EA\u05E8 \u05DE\u05DB\u05DC.`;
      descEn = `This shot was taken at f/${aperture} \u2014 a fast prime lens is the single investment that improves your photos most.`;
      btnHe = "\u05E8\u05D0\u05D4 \u05E2\u05D3\u05E9\u05D5\u05EA \u05D1\u05D0\u05D3\u05D5\u05E8\u05D0\u05DE\u05D4 \u2190";
      btnEn = "View Lenses at Adorama \u2192";
    } else if (shutterSec !== null && shutterSec >= 1) {
      link = "https://adorama.prf.hn/click/camref:1101l5Km5i/destination:https://www.adorama.com/catalog.tpl?SearchInfo=travel+tripod+lightweight";
      titleHe = "\u{1F4D0} \u05D7\u05E6\u05D5\u05D1\u05D4 \u2014 \u05D7\u05D5\u05D1\u05D4 \u05DC\u05D7\u05E9\u05D9\u05E4\u05D5\u05EA \u05D0\u05E8\u05D5\u05DB\u05D5\u05EA";
      titleEn2 = "\u{1F4D0} Tripod \u2014 Essential for Long Exposures";
      descHe = `\u05D7\u05E9\u05D9\u05E4\u05D4 \u05E9\u05DC ${cam.shutter?.value || ""} \u05D3\u05D5\u05E8\u05E9\u05EA \u05D9\u05E6\u05D9\u05D1\u05D5\u05EA \u05DE\u05D5\u05E9\u05DC\u05DE\u05EA. \u05D7\u05E6\u05D5\u05D1\u05D4 \u05E7\u05DC\u05D4 \u05D5\u05D0\u05D9\u05DB\u05D5\u05EA\u05D9\u05EA \u05DE\u05E9\u05E0\u05D4 \u05D4\u05DB\u05DC.`;
      descEn = `An exposure of ${cam.shutter?.value || ""} demands perfect stability. A lightweight quality tripod changes everything.`;
      btnHe = "\u05E8\u05D0\u05D4 \u05D7\u05E6\u05D5\u05D1\u05D5\u05EA \u05D1\u05D0\u05D3\u05D5\u05E8\u05D0\u05DE\u05D4 \u2190";
      btnEn = "View Tripods at Adorama \u2192";
    } else if (!isNaN(focal) && focal >= 100) {
      link = "https://adorama.prf.hn/click/camref:1101l5Km5i/destination:https://www.adorama.com/catalog.tpl?SearchInfo=70-200mm+telephoto+zoom+lens";
      titleHe = "\u{1F52D} \u05E2\u05D3\u05E9\u05EA \u05D8\u05DC\u05D4 \u2014 \u05D3\u05D7\u05D9\u05E1\u05EA \u05DE\u05E8\u05D7\u05E7\u05D9\u05DD \u05D5\u05E4\u05E8\u05E1\u05E4\u05E7\u05D8\u05D9\u05D1\u05D4 \u05D3\u05E8\u05DE\u05D8\u05D9\u05EA";
      titleEn2 = "\u{1F52D} Telephoto Lens \u2014 Distance Compression and Dramatic Perspective";
      descHe = `\u05E2\u05DD ${Math.round(focal)}mm \u05D4\u05E9\u05D2\u05EA \u05D3\u05D7\u05D9\u05E1\u05EA \u05DE\u05E8\u05D7\u05E7\u05D9\u05DD \u05DE\u05E8\u05E9\u05D9\u05DE\u05D4. \u05E2\u05D3\u05E9\u05EA \u05D6\u05D5\u05DD 70-200 \u05DE\u05D0\u05E4\u05E9\u05E8\u05EA \u05DC\u05DA \u05DC\u05E9\u05D7\u05E7 \u05E2\u05DD \u05D4\u05E4\u05E8\u05E1\u05E4\u05E7\u05D8\u05D9\u05D1\u05D4.`;
      descEn = `With ${Math.round(focal)}mm you achieved impressive compression. A 70-200 zoom lets you play with perspective.`;
      btnHe = "\u05E8\u05D0\u05D4 \u05E2\u05D3\u05E9\u05D5\u05EA \u05D8\u05DC\u05D4 \u2190";
      btnEn = "View Telephoto Lenses \u2192";
    } else {
      link = "https://skylum.evyy.net/c/3782640/1738804/5925";
      titleHe = "\u2728 Luminar Neo \u2014 \u05E2\u05E8\u05D5\u05DA \u05DB\u05DE\u05D5 \u05D4\u05E6\u05DC\u05DE\u05D9\u05DD \u05E9\u05D0\u05EA\u05D4 \u05DC\u05D5\u05DE\u05D3 \u05DE\u05D4\u05DD";
      titleEn2 = "\u2728 Luminar Neo \u2014 Edit Like the Photographers You Learn From";
      descHe = "\u05E2\u05E8\u05D9\u05DB\u05EA AI \u05D7\u05DB\u05DE\u05D4 \u2014 \u05E9\u05D9\u05E4\u05D5\u05E8 \u05D0\u05D5\u05D8\u05D5\u05DE\u05D8\u05D9, \u05E9\u05DC\u05D9\u05D8\u05D4 \u05E2\u05DC \u05E0\u05D9\u05D2\u05D5\u05D3 \u05D5\u05D0\u05D5\u05E8, \u05DB\u05DC\u05D9 \u05E9\u05D7\u05D5\u05E8-\u05DC\u05D1\u05DF \u05DE\u05E7\u05E6\u05D5\u05E2\u05D9\u05D9\u05DD.";
      descEn = "Smart AI editing \u2014 auto-enhance, contrast and light control, professional B&W tools.";
      btnHe = "\u05E0\u05E1\u05D4 \u05D7\u05D9\u05E0\u05DD \u2190";
      btnEn = "Try Free \u2192";
    }
    return `<div class="analysis-affiliate">
  <div class="analysis-affiliate-inner">
    <div>
      <div class="analysis-affiliate-title" data-he="${escXml(titleHe)}" data-en="${escXml(titleEn2)}">${escXml(titleHe)}</div>
      <div class="analysis-affiliate-desc" data-he="${escXml(descHe)}" data-en="${escXml(descEn)}">${escXml(descHe)}</div>
      <div class="analysis-affiliate-disclose" data-he="\u05E7\u05D9\u05E9\u05D5\u05E8 \u05E9\u05D5\u05EA\u05E3 \u2014 \u05E2\u05DE\u05DC\u05D4 \u05E7\u05D8\u05E0\u05D4, \u05DC\u05DC\u05D0 \u05E2\u05DC\u05D5\u05EA \u05E0\u05D5\u05E1\u05E4\u05EA \u05DC\u05DA" data-en="Affiliate link \u2014 small commission, no extra cost to you">\u05E7\u05D9\u05E9\u05D5\u05E8 \u05E9\u05D5\u05EA\u05E3 \u2014 \u05E2\u05DE\u05DC\u05D4 \u05E7\u05D8\u05E0\u05D4, \u05DC\u05DC\u05D0 \u05E2\u05DC\u05D5\u05EA \u05E0\u05D5\u05E1\u05E4\u05EA \u05DC\u05DA</div>
    </div>
    <a class="analysis-affiliate-btn" href="${escXml(link)}" target="_blank" rel="noopener sponsored"
       data-he="${escXml(btnHe)}" data-en="${escXml(btnEn)}">${escXml(btnHe)}</a>
  </div>
</div>`;
  }
  __name(buildAnalysisAffiliate, "buildAnalysisAffiliate");
  try {
    camera = JSON.parse(row.camera_json || "{}");
  } catch (_) {
    camera = {};
  }
  try {
    cameraEn = JSON.parse(row.camera_json_en || "{}");
  } catch (_) {
    cameraEn = {};
  }
  try {
    tags = JSON.parse(row.tags_json || "[]");
  } catch (_) {
    tags = [];
  }
  const ruleLabelHe = RULE_LABELS[row.composition_rule] || row.composition_rule;
  const ruleLabelEn = RULE_LABELS_EN[row.composition_rule] || row.composition_rule;
  const titleEn = row.title_en || row.title;
  const imgUrl = (photo.url || photo.thumbnail || "") + "?w=900";
  const buyUrl = `https://amitphotos.com/?photo=${encodeURIComponent(photoId)}`;
  const labelsHe = { aperture: "\u05E6\u05DE\u05E6\u05DD", shutter: "\u05DE\u05D4\u05D9\u05E8\u05D5\u05EA \u05EA\u05E8\u05D9\u05E1", iso: "ISO", focal: "\u05DE\u05E8\u05D7\u05E7 \u05DE\u05D5\u05E7\u05D3" };
  const labelsEn = { aperture: "Aperture", shutter: "Shutter Speed", iso: "ISO", focal: "Focal Length" };
  const cameraCards = ["aperture", "shutter", "iso", "focal"].map((key) => {
    const c = camera[key] || {};
    const cEn = cameraEn[key] || {};
    const descEn = cEn.explanation || c.explanation || "";
    return `<div class="cam-card">
      <div class="cam-label" data-he="${escXml(labelsHe[key])}" data-en="${escXml(labelsEn[key])}">${escXml(labelsHe[key])}</div>
      <div class="cam-value">${escXml(c.value || "\u2014")}</div>
      <div class="cam-desc lang-he">${escXml(c.explanation || "")}</div>
      <div class="cam-desc lang-en" style="display:none">${escXml(descEn)}</div>
    </div>`;
  }).join("\n");
  const tagPills = tags.map((t) => `<span class="tag">${escXml(t)}</span>`).join("");
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escXml(row.title)} \u2014 \u05E0\u05D9\u05EA\u05D5\u05D7 \u05E6\u05D9\u05DC\u05D5\u05DD | Amit Photos</title>
<meta name="description" content="\u05E0\u05D9\u05EA\u05D5\u05D7 \u05E6\u05D9\u05DC\u05D5\u05DE\u05D9 \u05E9\u05DC &quot;${escXml(row.title)}&quot; \u2014 ${escXml(ruleLabelHe)}, \u05D4\u05D2\u05D3\u05E8\u05D5\u05EA \u05DE\u05E6\u05DC\u05DE\u05D4, \u05D5\u05E4\u05D9\u05E8\u05D5\u05E9 \u05D4\u05E7\u05D5\u05DE\u05E4\u05D5\u05D6\u05D9\u05E6\u05D9\u05D4.">
<meta property="og:title" content="\u{1F4F8} ${escXml(row.title)} | \u05E0\u05D9\u05EA\u05D5\u05D7 \u05E6\u05D9\u05DC\u05D5\u05DD">
<meta property="og:description" content="\u05E0\u05D9\u05EA\u05D5\u05D7 ${escXml(ruleLabelHe)} \u2014 \u05D4\u05D2\u05D3\u05E8\u05D5\u05EA \u05DE\u05E6\u05DC\u05DE\u05D4 \u05D5\u05E4\u05D9\u05E8\u05D5\u05E9 \u05D4\u05E7\u05D5\u05DE\u05E4\u05D5\u05D6\u05D9\u05E6\u05D9\u05D4. \u05DE\u05D3\u05E8\u05D9\u05DA \u05DC\u05E6\u05DC\u05DE\u05DF \u05DE\u05EA\u05D7\u05D9\u05DC.">
<meta property="og:image" content="${escXml(photo.thumbnail || photo.url || "")}">
<meta property="og:type" content="article">
<meta property="og:url" content="https://amitphotos.com/learn/${escXml(photoId)}">
<meta property="og:locale" content="he_IL">
<link rel="canonical" href="https://amitphotos.com/learn/${escXml(photoId)}">
<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": row.title,
    "description": `\u05E0\u05D9\u05EA\u05D5\u05D7 \u05E6\u05D9\u05DC\u05D5\u05DE\u05D9 \u05E9\u05DC "${row.title}" \u2014 ${ruleLabelHe}, \u05D4\u05D2\u05D3\u05E8\u05D5\u05EA \u05DE\u05E6\u05DC\u05DE\u05D4, \u05D5\u05E4\u05D9\u05E8\u05D5\u05E9 \u05D4\u05E7\u05D5\u05DE\u05E4\u05D5\u05D6\u05D9\u05E6\u05D9\u05D4.`,
    "url": `https://amitphotos.com/learn/${photoId}`,
    "inLanguage": "he",
    "image": photo.thumbnail || photo.url || "",
    "author": { "@type": "Person", "name": "\u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6", "url": "https://amitphotos.com" },
    "publisher": { "@type": "Organization", "name": "Amit Photos", "url": "https://amitphotos.com" },
    "isPartOf": { "@type": "WebSite", "name": "Amit Photos", "url": "https://amitphotos.com" }
  })}<\/script>
${GA_SNIPPET}
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
.analysis-affiliate{max-width:900px;margin:1.5rem auto;padding:0 .75rem}
.analysis-affiliate-inner{background:linear-gradient(135deg,rgba(200,169,110,.08),rgba(200,169,110,.03));border:1px solid rgba(200,169,110,.3);border-radius:14px;padding:1.1rem 1.4rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.analysis-affiliate-title{font-family:'Syne',sans-serif;font-size:.9rem;color:var(--accent);margin-bottom:.25rem}
.analysis-affiliate-desc{font-size:.78rem;color:var(--muted)}
.analysis-affiliate-disclose{font-size:.63rem;color:#444;margin-top:.2rem}
.analysis-affiliate-btn{flex-shrink:0;background:var(--accent);color:#000;font-weight:700;font-size:.8rem;padding:.5rem 1.1rem;border-radius:8px;text-decoration:none;white-space:nowrap;transition:background .15s}
.analysis-affiliate-btn:hover{background:#e0c080}
</style>
<script src="/assets/js/nav.js" defer><\/script>
<script src="/assets/js/share.js" defer><\/script>
</head>
<body>
<div class="page-header">
  <div>
    <h1 class="page-title" data-he="${escXml(row.title)}" data-en="${escXml(titleEn)}">${escXml(row.title)}</h1>
    <span class="rule-badge" data-he="${escXml(ruleLabelHe)}" data-en="${escXml(ruleLabelEn)}">${escXml(ruleLabelHe)}</span>
  </div>
  <a class="buy-btn" href="${escXml(buyUrl)}" data-he="\u05E8\u05DB\u05D5\u05E9 \u05EA\u05DE\u05D5\u05E0\u05D4 \u05D6\u05D5 \u2190" data-en="Buy This Photo \u2190">\u05E8\u05DB\u05D5\u05E9 \u05EA\u05DE\u05D5\u05E0\u05D4 \u05D6\u05D5 \u2190</a>
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
  <button id="ann-hide-btn" onclick="annHideAll()" style="display:none;background:rgba(200,169,110,.1);border:1px solid rgba(200,169,110,.3);color:#c8a96e;border-radius:20px;padding:.35rem 1.2rem;font-family:'Heebo',sans-serif;font-size:.82rem;cursor:pointer" data-he="\u05D4\u05E1\u05EA\u05E8 \u05D1\u05D9\u05D0\u05D5\u05E8\u05D9\u05DD" data-en="Hide Annotations">\u05D4\u05E1\u05EA\u05E8 \u05D1\u05D9\u05D0\u05D5\u05E8\u05D9\u05DD</button>
</div>` : ""}

<div class="cam-cards">${cameraCards}</div>

${(() => {
    const d = buildPhysicsDiagram(camera);
    return `<div class="section"><h2 data-he="${escXml(d.title)}" data-en="${escXml(d.titleEn || d.title)}">${escXml(d.title)}</h2><div class="bokeh-box">${d.svg}</div></div>`;
  })()}

<div class="section">
  <h2 data-he="\u{1F3A8} \u05E0\u05D9\u05EA\u05D5\u05D7 \u05E7\u05D5\u05DE\u05E4\u05D5\u05D6\u05D9\u05E6\u05D9\u05D4" data-en="\u{1F3A8} Composition Analysis">\u{1F3A8} \u05E0\u05D9\u05EA\u05D5\u05D7 \u05E7\u05D5\u05DE\u05E4\u05D5\u05D6\u05D9\u05E6\u05D9\u05D4</h2>
  <div class="comp-box">
    <div class="lang-he">${String(row.composition_html || "").replace(/<(?!\/?(?:p|strong|em|br|span|div)\b)[^>]*>/gi, "")}</div>
    <div class="lang-en" style="display:none">${String(row.composition_html_en || row.composition_html || "").replace(/<(?!\/?(?:p|strong|em|br|span|div)\b)[^>]*>/gi, "")}</div>
    <div class="tags-row">${tagPills}</div>
  </div>
</div>

${prevRow || nextRow ? `
<div class="analysis-nav">
  ${prevRow ? `<a href="/learn/${escXml(prevRow.photo_id)}" class="nav-next"><span class="nav-dir" data-he="\u2190 \u05E0\u05D9\u05EA\u05D5\u05D7 \u05D7\u05D3\u05E9 \u05D9\u05D5\u05EA\u05E8" data-en="\u2190 Newer Analysis">\u2190 \u05E0\u05D9\u05EA\u05D5\u05D7 \u05D7\u05D3\u05E9 \u05D9\u05D5\u05EA\u05E8</span><span class="nav-title" data-he="${escXml(prevRow.title)}" data-en="${escXml(prevRow.title_en || prevRow.title)}">${escXml(prevRow.title)}</span></a>` : "<span></span>"}
  ${nextRow ? `<a href="/learn/${escXml(nextRow.photo_id)}" class="nav-older"><span class="nav-dir" data-he="\u05E0\u05D9\u05EA\u05D5\u05D7 \u05E7\u05D5\u05D3\u05DD \u2192" data-en="Older Analysis \u2192">\u05E0\u05D9\u05EA\u05D5\u05D7 \u05E7\u05D5\u05D3\u05DD \u2192</span><span class="nav-title" data-he="${escXml(nextRow.title)}" data-en="${escXml(nextRow.title_en || nextRow.title)}">${escXml(nextRow.title)}</span></a>` : "<span></span>"}
</div>` : ""}

${moreAnalyses.length > 0 ? `
<div class="more-section">
  <h2 data-he="\u{1F4F8} \u05E0\u05D9\u05EA\u05D5\u05D7\u05D9\u05DD \u05E0\u05D5\u05E1\u05E4\u05D9\u05DD" data-en="\u{1F4F8} More Analyses">\u{1F4F8} \u05E0\u05D9\u05EA\u05D5\u05D7\u05D9\u05DD \u05E0\u05D5\u05E1\u05E4\u05D9\u05DD</h2>
  <div class="more-grid">
    ${moreAnalyses.map((a) => {
    const thumb = (a.thumbnail || a.url || "") + "?w=300";
    const labelHe = RULE_LABELS[a.composition_rule] || a.composition_rule || "";
    const labelEn = RULE_LABELS_EN[a.composition_rule] || a.composition_rule || "";
    const aTitleEn = a.title_en || a.title;
    return `<a class="more-card" href="/learn/${escXml(a.photo_id)}">
        <img src="${escXml(thumb)}" alt="${escXml(a.title)}" loading="lazy">
        <div class="more-card-body">
          <div class="more-card-rule" data-he="${escXml(labelHe)}" data-en="${escXml(labelEn)}">${escXml(labelHe)}</div>
          <div class="more-card-title" data-he="${escXml(a.title)}" data-en="${escXml(aTitleEn)}">${escXml(a.title)}</div>
        </div>
      </a>`;
  }).join("")}
  </div>
</div>` : ""}

${buildAnalysisAffiliate(camera)}

<div class="nav-row nav-prev">
  <a href="/learn/" data-he="\u2190 \u05DB\u05DC \u05D4\u05E0\u05D9\u05EA\u05D5\u05D7\u05D9\u05DD" data-en="\u2190 All Analyses">\u2190 \u05DB\u05DC \u05D4\u05E0\u05D9\u05EA\u05D5\u05D7\u05D9\u05DD</a>
  <a href="${escXml(buyUrl)}" data-he="\u05E8\u05DB\u05D5\u05E9 \u05EA\u05DE\u05D5\u05E0\u05D4 \u05D6\u05D5" data-en="Buy This Photo">\u05E8\u05DB\u05D5\u05E9 \u05EA\u05DE\u05D5\u05E0\u05D4 \u05D6\u05D5</a>
  <a href="https://amitphotos.com" data-he="\u05DC\u05D2\u05DC\u05E8\u05D9\u05D4" data-en="Gallery">\u05DC\u05D2\u05DC\u05E8\u05D9\u05D4</a>
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
<\/script>
</body>
</html>`;
  return htmlRes(html);
}
__name(handleLearnAnalysis, "handleLearnAnalysis");
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
__name(handleLocationsList, "handleLocationsList");
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
__name(haversineKm, "haversineKm");
async function handleLocationsGet(request, env, slug) {
  const loc = await env.DB.prepare(
    "SELECT * FROM locations WHERE id = ? AND published = 1"
  ).bind(slug).first();
  if (!loc) return jsonRes({ error: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" }, 404, request);
  const { results: photos } = await env.DB.prepare(
    "SELECT * FROM location_photos WHERE location_id = ? ORDER BY sort_order ASC"
  ).bind(slug).all();
  let nearby = [];
  if (loc.coordinates) {
    const [lat, lng] = loc.coordinates.split(",").map((s) => parseFloat(s.trim()));
    if (!isNaN(lat) && !isNaN(lng)) {
      const { results: others } = await env.DB.prepare(
        "SELECT l.id, l.title, l.title_en, l.coordinates, (SELECT lp.thumbnail FROM location_photos lp WHERE lp.location_id = l.id ORDER BY lp.sort_order ASC LIMIT 1) AS cover_thumb FROM locations l WHERE l.published = 1 AND l.id != ? AND l.coordinates IS NOT NULL AND l.coordinates != ''"
      ).bind(slug).all();
      nearby = (others || []).map((o) => {
        const [olat, olng] = o.coordinates.split(",").map((s) => parseFloat(s.trim()));
        return isNaN(olat) ? null : { id: o.id, title: o.title, title_en: o.title_en || null, cover_thumb: o.cover_thumb, km: Math.round(haversineKm(lat, lng, olat, olng)) };
      }).filter(Boolean).sort((a, b) => a.km - b.km).slice(0, 3);
    }
  }
  const safeJson = /* @__PURE__ */ __name((s, fallback) => {
    try {
      return s ? JSON.parse(s) : fallback;
    } catch {
      return fallback;
    }
  }, "safeJson");
  return jsonRes({
    ...loc,
    related_guides: safeJson(loc.related_guides, []),
    extra_links: safeJson(loc.extra_links, []),
    when_to_visit: safeJson(loc.when_to_visit, null),
    recommended_gear: safeJson(loc.recommended_gear, null),
    when_to_visit_en: safeJson(loc.when_to_visit_en, null),
    recommended_gear_en: safeJson(loc.recommended_gear_en, null),
    nearby,
    photos: photos || []
  }, 200, request);
}
__name(handleLocationsGet, "handleLocationsGet");
async function handleLocationsSuggest(request, env) {
  if (request.method !== "POST") return jsonRes({ error: "POST only" }, 405, request);
  if (!env.RESEND_API_KEY) return jsonRes({ error: "RESEND_API_KEY \u05D7\u05E1\u05E8" }, 500, request);
  const { type, location_slug, sender_name, message } = await request.json().catch(() => ({}));
  if (!message || !message.trim()) return jsonRes({ error: "\u05D4\u05D5\u05D3\u05E2\u05D4 \u05E8\u05D9\u05E7\u05D4" }, 400, request);
  const isNew = type === "new";
  const subject = isNew ? `\u05D4\u05E6\u05E2\u05EA \u05DE\u05E7\u05D5\u05DD \u05D7\u05D3\u05E9${sender_name ? ` \u05DE-${sender_name}` : ""}` : `\u05EA\u05D9\u05E7\u05D5\u05DF \u05DC\u05DE\u05E7\u05D5\u05DD: ${location_slug}${sender_name ? ` \u05DE-${sender_name}` : ""}`;
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
    <h2 style="color:#c8a96e">${subject}</h2>
    ${sender_name ? `<p><strong>\u05E9\u05DD:</strong> ${sender_name}</p>` : ""}
    ${!isNew ? `<p><strong>\u05DE\u05E7\u05D5\u05DD:</strong> ${location_slug}</p>` : ""}
    <p><strong>\u05D4\u05D5\u05D3\u05E2\u05D4:</strong></p>
    <p style="background:#111;padding:1rem;border-radius:4px;white-space:pre-wrap">${message}</p>
  </div>`;
  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Amit Photos <onboarding@resend.dev>", to: ["erez.family@gmail.com"], subject, html })
  });
  if (!emailRes.ok) return jsonRes({ error: "\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05E9\u05DC\u05D9\u05D7\u05EA \u05D4\u05DE\u05D9\u05D9\u05DC" }, 502, request);
  return jsonRes({ ok: true }, 200, request);
}
__name(handleLocationsSuggest, "handleLocationsSuggest");
async function enrichLocationWithAI(locationName, env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const GUIDE_PATHS = [
    "/camera/filters/",
    "/camera/composition/",
    "/camera/exposure/",
    "/camera/depth-of-field/",
    "/camera/white-balance/",
    "/camera/histogram/",
    "/camera/light/",
    "/camera/dynamic-range/",
    "/camera/controls/",
    "/camera/lenses/",
    "/camera/types/"
  ];
  const prompt = `You are helping a professional Israeli photographer catalog shooting locations.
For the location "${locationName}", return a JSON object with these fields:
- description: 2-3 sentences in Hebrew about the location and its photographic qualities
- best_time: best time(s) to photograph there (Hebrew, e.g. "\u05D6\u05E8\u05D9\u05D7\u05D4 \u2014 \u05E9\u05E2\u05EA \u05D4\u05D6\u05D4\u05D1")
- equipment: recommended camera equipment (Hebrew, e.g. "\u05D7\u05E6\u05D5\u05D1\u05D4, \u05E2\u05D3\u05E9\u05D4 14-24mm, \u05E4\u05D9\u05DC\u05D8\u05E8 ND")
- my_tip: one personal photography tip in Hebrew, first person (e.g. "\u05D0\u05E0\u05D9 \u05DE\u05DE\u05DC\u05D9\u05E5 \u05DC\u05D4\u05D2\u05D9\u05E2...")
- coordinates: "lat,lng" GPS string for this location (e.g. "31.7683,35.2137"). For international locations use real GPS.
- related_guides: array of 1-3 paths from this list that are most relevant: ${JSON.stringify(GUIDE_PATHS)}
- when_to_visit: object with keys "summer","fall","winter","spring". Each value: {"rating":"good"|"ok"|"bad","note":"one short Hebrew sentence about light/weather/crowds"}
- recommended_gear: array of objects [{name:"Hebrew gear name", primary:true|false}]. Mark the single most important lens/item as primary:true. 3-6 items total.

Return ONLY valid JSON, no markdown fences, no extra text.`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("Anthropic API error:", res.status, errText.slice(0, 300));
      return null;
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text || "";
    const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error("enrichLocationWithAI error:", e?.message);
    return null;
  }
}
__name(enrichLocationWithAI, "enrichLocationWithAI");
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
__name(handleAdminLocationsList, "handleAdminLocationsList");
async function handleAdminLocationsCreate(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "POST only" }, 405, request);
  const { title, region } = await request.json().catch(() => ({}));
  if (!title || !title.trim()) return jsonRes({ error: "\u05DB\u05D5\u05EA\u05E8\u05EA \u05D7\u05E1\u05E8\u05D4" }, 400, request);
  const id = slugify(title);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existing = await env.DB.prepare("SELECT id FROM locations WHERE id = ?").bind(id).first();
  if (existing) return jsonRes({ error: `slug "${id}" \u05DB\u05D1\u05E8 \u05E7\u05D9\u05D9\u05DD` }, 409, request);
  await env.DB.prepare(
    "INSERT INTO locations (id, title, region, published, created_at) VALUES (?,?,?,0,?)"
  ).bind(id, title.trim(), region || "", now).run();
  const enriched = await enrichLocationWithAI(title, env);
  if (enriched) {
    await env.DB.prepare(`
      UPDATE locations SET
        description = ?, best_time = ?, equipment = ?,
        my_tip = ?, coordinates = ?, related_guides = ?,
        when_to_visit = ?, recommended_gear = ?
      WHERE id = ?
    `).bind(
      enriched.description || "",
      enriched.best_time || "",
      enriched.equipment || "",
      enriched.my_tip || "",
      enriched.coordinates || "",
      JSON.stringify(enriched.related_guides || []),
      enriched.when_to_visit ? JSON.stringify(enriched.when_to_visit) : null,
      enriched.recommended_gear ? JSON.stringify(enriched.recommended_gear) : null,
      id
    ).run();
  }
  const loc = await env.DB.prepare("SELECT * FROM locations WHERE id = ?").bind(id).first();
  const safeJson = /* @__PURE__ */ __name((s, fb) => {
    try {
      return s ? JSON.parse(s) : fb;
    } catch {
      return fb;
    }
  }, "safeJson");
  return jsonRes({ ...loc, related_guides: safeJson(loc.related_guides, []) }, 201, request);
}
__name(handleAdminLocationsCreate, "handleAdminLocationsCreate");
async function handleAdminLocationsUpdate(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "PUT") return jsonRes({ error: "PUT only" }, 405, request);
  const body = await request.json().catch(() => ({}));
  const fields = [
    "title",
    "region",
    "description",
    "best_time",
    "equipment",
    "my_tip",
    "coordinates",
    "published",
    "when_to_visit",
    "recommended_gear",
    "title_en",
    "description_en",
    "best_time_en",
    "equipment_en",
    "my_tip_en"
  ];
  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (body[f] !== void 0) {
      sets.push(`${f} = ?`);
      vals.push(f === "published" ? body[f] ? 1 : 0 : body[f]);
    }
  }
  if (body.related_guides !== void 0) {
    sets.push("related_guides = ?");
    vals.push(JSON.stringify(body.related_guides));
  }
  if (body.extra_links !== void 0) {
    sets.push("extra_links = ?");
    vals.push(JSON.stringify(body.extra_links));
  }
  if (body.when_to_visit_en !== void 0) {
    sets.push("when_to_visit_en = ?");
    vals.push(body.when_to_visit_en);
  }
  if (body.recommended_gear_en !== void 0) {
    sets.push("recommended_gear_en = ?");
    vals.push(body.recommended_gear_en);
  }
  if (sets.length === 0) return jsonRes({ error: "\u05D0\u05D9\u05DF \u05E9\u05D3\u05D5\u05EA \u05DC\u05E2\u05D3\u05DB\u05D5\u05DF" }, 400, request);
  const exists = await env.DB.prepare("SELECT id FROM locations WHERE id = ?").bind(slug).first();
  if (!exists) return jsonRes({ error: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" }, 404, request);
  vals.push(slug);
  await env.DB.prepare(`UPDATE locations SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  const loc = await env.DB.prepare("SELECT * FROM locations WHERE id = ?").bind(slug).first();
  if (!loc) return jsonRes({ error: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" }, 404, request);
  const safeJson = /* @__PURE__ */ __name((s, fb) => {
    try {
      return s ? JSON.parse(s) : fb;
    } catch {
      return fb;
    }
  }, "safeJson");
  return jsonRes({ ...loc, related_guides: safeJson(loc.related_guides, []), extra_links: safeJson(loc.extra_links, []) }, 200, request);
}
__name(handleAdminLocationsUpdate, "handleAdminLocationsUpdate");
async function handleAdminLocationsDelete(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "DELETE") return jsonRes({ error: "DELETE only" }, 405, request);
  const { results: exclusivePhotos } = await env.DB.prepare(
    "SELECT r2_key FROM location_photos WHERE location_id = ? AND type = 'exclusive' AND r2_key IS NOT NULL"
  ).bind(slug).all();
  for (const p of exclusivePhotos || []) {
    await env.PHOTOS.delete(p.r2_key).catch(() => {
    });
  }
  await env.DB.prepare("DELETE FROM location_photos WHERE location_id = ?").bind(slug).run();
  await env.DB.prepare("DELETE FROM locations WHERE id = ?").bind(slug).run();
  return jsonRes({ ok: true }, 200, request);
}
__name(handleAdminLocationsDelete, "handleAdminLocationsDelete");
async function handleAdminLocationsEnrich(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "POST only" }, 405, request);
  const loc = await env.DB.prepare("SELECT title FROM locations WHERE id = ?").bind(slug).first();
  if (!loc) return jsonRes({ error: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" }, 404, request);
  const enriched = await enrichLocationWithAI(loc.title, env);
  if (!enriched) return jsonRes({ error: "AI enrich \u05E0\u05DB\u05E9\u05DC" }, 500, request);
  await env.DB.prepare(`
    UPDATE locations SET
      description = ?, best_time = ?, equipment = ?,
      my_tip = ?, coordinates = ?, related_guides = ?,
      when_to_visit = ?, recommended_gear = ?
    WHERE id = ?
  `).bind(
    enriched.description || "",
    enriched.best_time || "",
    enriched.equipment || "",
    enriched.my_tip || "",
    enriched.coordinates || "",
    JSON.stringify(enriched.related_guides || []),
    enriched.when_to_visit ? JSON.stringify(enriched.when_to_visit) : null,
    enriched.recommended_gear ? JSON.stringify(enriched.recommended_gear) : null,
    slug
  ).run();
  const updated = await env.DB.prepare("SELECT * FROM locations WHERE id = ?").bind(slug).first();
  return jsonRes({
    ...updated,
    related_guides: JSON.parse(updated.related_guides || "[]"),
    extra_links: JSON.parse(updated.extra_links || "[]"),
    when_to_visit: updated.when_to_visit ? JSON.parse(updated.when_to_visit) : null,
    recommended_gear: updated.recommended_gear ? JSON.parse(updated.recommended_gear) : null
  }, 200, request);
}
__name(handleAdminLocationsEnrich, "handleAdminLocationsEnrich");
async function handleAdminLocationsGet(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  const loc = await env.DB.prepare("SELECT * FROM locations WHERE id = ?").bind(slug).first();
  if (!loc) return jsonRes({ error: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" }, 404, request);
  const { results: photos } = await env.DB.prepare(
    "SELECT * FROM location_photos WHERE location_id = ? ORDER BY sort_order ASC"
  ).bind(slug).all();
  const safeJson = /* @__PURE__ */ __name((s, fallback) => {
    try {
      return s ? JSON.parse(s) : fallback;
    } catch {
      return fallback;
    }
  }, "safeJson");
  return jsonRes({
    ...loc,
    related_guides: safeJson(loc.related_guides, []),
    extra_links: safeJson(loc.extra_links, []),
    when_to_visit: safeJson(loc.when_to_visit, null),
    recommended_gear: safeJson(loc.recommended_gear, null),
    when_to_visit_en: safeJson(loc.when_to_visit_en, null),
    recommended_gear_en: safeJson(loc.recommended_gear_en, null),
    photos: photos || []
  }, 200, request);
}
__name(handleAdminLocationsGet, "handleAdminLocationsGet");
async function handleAdminLocationsGenerateEn(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "POST only" }, 405, request);
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: "ANTHROPIC_API_KEY \u05D7\u05E1\u05E8" }, 500, request);
  const loc = await env.DB.prepare("SELECT * FROM locations WHERE id = ?").bind(slug).first();
  if (!loc) return jsonRes({ error: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" }, 404, request);
  const prompt = `You are Amit Erez, an Israeli travel photographer writing for an international photography audience.
Translate and adapt the following Hebrew photography location data to English. Write in first person, personal and inspiring tone, as if you visited this place yourself and want to help other photographers get the best shots.

Location data:
Title: ${loc.title}
Region: ${loc.region}
Description: ${loc.description || ""}
Best time to visit: ${loc.best_time || ""}
Equipment: ${loc.equipment || ""}
My tip: ${loc.my_tip || ""}
When to visit (JSON): ${loc.when_to_visit || "null"}
Recommended gear (JSON): ${loc.recommended_gear || "null"}

Return ONLY valid JSON with these exact keys \u2014 no markdown, no explanation:
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
- For recommended_gear_en: keep the exact same "primary" boolean values, translate gear names to standard English photography terminology (e.g. "\u05E2\u05D3\u05E9\u05D4 \u05E8\u05D7\u05D1\u05D4 16-35mm" becomes "Wide-angle 16-35mm").
- If a field is empty or null in Hebrew, return an empty string for its English version.`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!res.ok) return jsonRes({ error: "Claude API \u05E0\u05DB\u05E9\u05DC", status: res.status }, 502, request);
  const data = await res.json();
  const text = (data.content?.[0]?.text || "").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return jsonRes({ error: "JSON \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF \u05DE-Claude" }, 500, request);
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return jsonRes({ error: "JSON \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF \u05DE-Claude" }, 500, request);
    }
  }
  const when_to_visit_en = typeof parsed.when_to_visit_en === "object" ? JSON.stringify(parsed.when_to_visit_en) : parsed.when_to_visit_en || null;
  const recommended_gear_en = Array.isArray(parsed.recommended_gear_en) ? JSON.stringify(parsed.recommended_gear_en) : parsed.recommended_gear_en || null;
  await env.DB.prepare(`
    UPDATE locations SET
      title_en = ?, description_en = ?, best_time_en = ?,
      equipment_en = ?, my_tip_en = ?,
      when_to_visit_en = ?, recommended_gear_en = ?
    WHERE id = ?
  `).bind(
    parsed.title_en || "",
    parsed.description_en || "",
    parsed.best_time_en || "",
    parsed.equipment_en || "",
    parsed.my_tip_en || "",
    when_to_visit_en,
    recommended_gear_en,
    slug
  ).run();
  return jsonRes({ message: 200, title_en: parsed.title_en || "" }, 200, request);
}
__name(handleAdminLocationsGenerateEn, "handleAdminLocationsGenerateEn");
async function handleAdminLocationPhotosAdd(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "POST only" }, 405, request);
  const loc = await env.DB.prepare("SELECT id FROM locations WHERE id = ?").bind(slug).first();
  if (!loc) return jsonRes({ error: "\u05DE\u05E7\u05D5\u05DD \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" }, 404, request);
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    const forSale = formData.get("for_sale") === "1" ? 1 : 0;
    if (!file) return jsonRes({ error: "\u05E7\u05D5\u05D1\u05E5 \u05D7\u05E1\u05E8" }, 400, request);
    const ext = file.name.split(".").pop().toLowerCase() || "jpg";
    const uuid = crypto.randomUUID();
    const r2Key = `locations/${slug}/${uuid}.${ext}`;
    const buf = await file.arrayBuffer();
    await env.PHOTOS.put(r2Key, buf, { httpMetadata: { contentType: file.type || "image/jpeg" } });
    const url = `${new URL(request.url).origin}/photos/${r2Key}`;
    const { results: maxSort } = await env.DB.prepare(
      "SELECT MAX(sort_order) AS m FROM location_photos WHERE location_id = ?"
    ).bind(slug).all();
    const nextSort = (maxSort?.[0]?.m ?? -1) + 1;
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO location_photos (id, location_id, type, r2_key, url, thumbnail, sort_order, for_sale) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(id, slug, "exclusive", r2Key, url, url, nextSort, forSale).run();
    return jsonRes({ id, type: "exclusive", url, thumbnail: url, sort_order: nextSort, for_sale: forSale }, 201, request);
  } else {
    const { photo_id, for_sale } = await request.json().catch(() => ({}));
    if (!photo_id) return jsonRes({ error: "photo_id \u05D7\u05E1\u05E8" }, 400, request);
    const photo = await env.DB.prepare("SELECT url, thumbnail FROM photos WHERE id = ?").bind(photo_id).first();
    if (!photo) return jsonRes({ error: "\u05EA\u05DE\u05D5\u05E0\u05D4 \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D4" }, 404, request);
    const { results: maxSort } = await env.DB.prepare(
      "SELECT MAX(sort_order) AS m FROM location_photos WHERE location_id = ?"
    ).bind(slug).all();
    const nextSort = (maxSort?.[0]?.m ?? -1) + 1;
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO location_photos (id, location_id, type, photo_id, url, thumbnail, sort_order, for_sale) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(id, slug, "gallery", photo_id, photo.url, photo.thumbnail, nextSort, for_sale ? 1 : 0).run();
    return jsonRes({ id, type: "gallery", photo_id, url: photo.url, thumbnail: photo.thumbnail, sort_order: nextSort, for_sale: for_sale ? 1 : 0 }, 201, request);
  }
}
__name(handleAdminLocationPhotosAdd, "handleAdminLocationPhotosAdd");
async function handleAdminLocationPhotosDelete(request, env, slug, photoEntryId) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "DELETE") return jsonRes({ error: "DELETE only" }, 405, request);
  const entry = await env.DB.prepare(
    "SELECT type, r2_key FROM location_photos WHERE id = ? AND location_id = ?"
  ).bind(photoEntryId, slug).first();
  if (!entry) return jsonRes({ error: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" }, 404, request);
  if (entry.type === "exclusive" && entry.r2_key) {
    await env.PHOTOS.delete(entry.r2_key).catch(() => {
    });
  }
  await env.DB.prepare("DELETE FROM location_photos WHERE id = ?").bind(photoEntryId).run();
  return jsonRes({ ok: true }, 200, request);
}
__name(handleAdminLocationPhotosDelete, "handleAdminLocationPhotosDelete");
async function handleAdminLocationPhotosReorder(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "POST only" }, 405, request);
  const { order } = await request.json().catch(() => ({}));
  if (!Array.isArray(order)) return jsonRes({ error: "order \u05D7\u05E1\u05E8" }, 400, request);
  for (let i = 0; i < order.length; i++) {
    await env.DB.prepare(
      "UPDATE location_photos SET sort_order = ? WHERE id = ? AND location_id = ?"
    ).bind(i, order[i], slug).run();
  }
  return jsonRes({ ok: true }, 200, request);
}
__name(handleAdminLocationPhotosReorder, "handleAdminLocationPhotosReorder");
async function handleAdminLocationPhotoAddToGallery(request, env, slug, photoId) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { category } = await request.json().catch(() => ({}));
  if (!category) return jsonRes({ error: "\u05E7\u05D8\u05D2\u05D5\u05E8\u05D9\u05D4 \u05D7\u05E1\u05E8\u05D4" }, 400, request);
  const locPhoto = await env.DB.prepare(
    "SELECT url, thumbnail, r2_key FROM location_photos WHERE id = ? AND location_id = ?"
  ).bind(photoId, slug).first();
  if (!locPhoto) return jsonRes({ error: "\u05EA\u05DE\u05D5\u05E0\u05D4 \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D4" }, 404, request);
  const title = await generateHebrewTitle(locPhoto.url, category, env) || category;
  const newId = crypto.randomUUID();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    `INSERT INTO photos (id, title, category, description, filename, r2_key, url, thumbnail, created_at, published, is_new)
     VALUES (?,?,?,?,?,?,?,?,?,1,1)`
  ).bind(
    newId,
    title,
    category,
    "",
    "",
    locPhoto.r2_key || "",
    locPhoto.url,
    locPhoto.thumbnail || locPhoto.url,
    now
  ).run();
  await env.DB.prepare(
    "UPDATE location_photos SET photo_id = ?, for_sale = 1 WHERE id = ? AND location_id = ?"
  ).bind(newId, photoId, slug).run();
  return jsonRes({ id: newId, title, category }, 201, request);
}
__name(handleAdminLocationPhotoAddToGallery, "handleAdminLocationPhotoAddToGallery");
async function findOrCreateBoard(categoryName, env, token) {
  const cacheKey = `pinterest_board_${categoryName}`;
  const cached = await env.DB.prepare(`SELECT value FROM settings WHERE key=?`).bind(cacheKey).first();
  if (cached) return cached.value;
  const boardsRes = await fetch("https://api.pinterest.com/v5/boards?page_size=100", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const boardsData = await boardsRes.json();
  const boards = boardsData.items || [];
  const match = boards.find((b) => b.name.toLowerCase() === categoryName.toLowerCase());
  const upsertCache = /* @__PURE__ */ __name((id) => env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).bind(cacheKey, id).run(), "upsertCache");
  if (match) {
    await upsertCache(match.id);
    return match.id;
  }
  const createRes = await fetch("https://api.pinterest.com/v5/boards", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: categoryName, privacy: "PUBLIC" })
  });
  const board = await createRes.json();
  if (board.id) {
    await upsertCache(board.id);
    return board.id;
  }
  return null;
}
__name(findOrCreateBoard, "findOrCreateBoard");
function toAbsolutePhotoUrl(url) {
  if (!url) return "";
  const s = url.trim();
  if (s.startsWith("http")) return s;
  return `https://amitphotos.com${s.startsWith("/") ? "" : "/"}${s}`;
}
__name(toAbsolutePhotoUrl, "toAbsolutePhotoUrl");
async function autoPostPhotoToPinterest(photoId, photo, env) {
  try {
    const token = await getPinterestToken(env);
    if (!token || !photo.category) return;
    const photoUrl = toAbsolutePhotoUrl(photo.url);
    const link = `https://amitphotos.com/?photo=${photoId}&buy=1`;
    const [boardId, boardIdEn, titleEn] = await Promise.all([
      findOrCreateBoard(photo.category, env, token),
      findOrCreateBoardEn(photo.category, env, token),
      translateTitleEn(photo.title, photo.description, photo.category, env)
    ]);
    if (boardId) {
      const pinRes = await fetch("https://api.pinterest.com/v5/pins", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          link,
          title: photo.title || "",
          description: (photo.description || "") + "\n\n\u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6 \u05E6\u05D9\u05DC\u05D5\u05DD | amitphotos.com",
          board_id: boardId,
          media_source: { source_type: "image_url", url: photoUrl }
        })
      });
      const pinData = await pinRes.json();
      if (pinData.id) await env.DB.prepare(`UPDATE photos SET pinterest_pin_id=? WHERE id=?`).bind(pinData.id, photoId).run();
    }
    if (boardIdEn) {
      await new Promise((r) => setTimeout(r, 600));
      const englishCategory = HE_TO_EN_CATEGORY[photo.category] || photo.category;
      const pinResEn = await fetch("https://api.pinterest.com/v5/pins", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          link,
          title: titleEn || `${englishCategory} | Amit Erez`,
          description: `Fine art photography by Israeli photographer Amit Erez.
${englishCategory}. Available as high-quality prints at amitphotos.com.
#photography #fineartphotography #israeliphotographer #amiterezphotography`,
          board_id: boardIdEn,
          media_source: { source_type: "image_url", url: photoUrl }
        })
      });
      const pinDataEn = await pinResEn.json();
      if (pinDataEn.id) await env.DB.prepare(`UPDATE photos SET pinterest_pin_id_en=? WHERE id=?`).bind(pinDataEn.id, photoId).run();
    }
  } catch {
  }
}
__name(autoPostPhotoToPinterest, "autoPostPhotoToPinterest");
async function handlePinterestSyncByCategory(request, env) {
  if (!await checkAuth(request, env)) return jsonRes({ error: "unauth" }, 401, request);
  const token = await getPinterestToken(env);
  if (!token) return jsonRes({ error: "Pinterest \u05DC\u05D0 \u05DE\u05D7\u05D5\u05D1\u05E8" }, 400, request);
  const perCategory = Math.min(parseInt(new URL(request.url).searchParams.get("per") || "3"), 5);
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
      if (!boardId) {
        failed++;
        errors.push(`no_board:${photo.category}`);
        continue;
      }
      const photoUrl = toAbsolutePhotoUrl(photo.url);
      const pinRes = await fetch("https://api.pinterest.com/v5/pins", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          link: `https://amitphotos.com/?photo=${photo.id}&buy=1`,
          title: photo.title || "",
          description: (photo.description || "") + "\n\n\u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6 \u05E6\u05D9\u05DC\u05D5\u05DD | amitphotos.com",
          board_id: boardId,
          media_source: { source_type: "image_url", url: photoUrl }
        })
      });
      const pinData = await pinRes.json();
      if (pinData.id) {
        await env.DB.prepare(`UPDATE photos SET pinterest_pin_id=? WHERE id=?`).bind(pinData.id, photo.id).run();
        posted++;
      } else {
        failed++;
        if (errors.length < 10) errors.push(pinData.message || pinData.code || JSON.stringify(pinData).slice(0, 120));
      }
    } catch (e) {
      failed++;
      if (errors.length < 10) errors.push(e.message);
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  const remaining = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM photos WHERE (pinterest_pin_id IS NULL OR pinterest_pin_id='') AND published=1 AND r2_key IS NOT NULL AND r2_key != ''`
  ).first();
  return jsonRes({ posted, failed, errors, remaining: remaining?.cnt || 0, categories: [...new Set(results.map((p) => p.category))] }, 200, request);
}
__name(handlePinterestSyncByCategory, "handlePinterestSyncByCategory");
async function handlePinterestSyncAll(request, env) {
  if (!await checkAuth(request, env)) return jsonRes({ error: "unauth" }, 401, request);
  const token = await getPinterestToken(env);
  if (!token) return jsonRes({ error: "Pinterest \u05DC\u05D0 \u05DE\u05D7\u05D5\u05D1\u05E8" }, 400, request);
  const limit = Math.min(parseInt(new URL(request.url).searchParams.get("limit") || "20"), 20);
  const { results } = await env.DB.prepare(
    `SELECT * FROM photos WHERE (pinterest_pin_id IS NULL OR pinterest_pin_id='') AND published=1 AND r2_key IS NOT NULL AND r2_key != '' ORDER BY created_at DESC LIMIT ?`
  ).bind(limit).all();
  let posted = 0, failed = 0;
  const errors = [];
  for (const photo of results) {
    try {
      const boardId = await findOrCreateBoard(photo.category, env, token);
      if (!boardId) {
        failed++;
        errors.push(`no_board:${photo.category}`);
        continue;
      }
      const photoUrl = toAbsolutePhotoUrl(photo.url);
      const pinRes = await fetch("https://api.pinterest.com/v5/pins", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          link: `https://amitphotos.com/?photo=${photo.id}&buy=1`,
          title: photo.title || "",
          description: (photo.description || "") + "\n\n\u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6 \u05E6\u05D9\u05DC\u05D5\u05DD | amitphotos.com",
          board_id: boardId,
          media_source: { source_type: "image_url", url: photoUrl }
        })
      });
      const pinData = await pinRes.json();
      if (pinData.id) {
        await env.DB.prepare(`UPDATE photos SET pinterest_pin_id=? WHERE id=?`).bind(pinData.id, photo.id).run();
        posted++;
      } else {
        failed++;
        if (errors.length < 10) errors.push(pinData.message || pinData.code || JSON.stringify(pinData).slice(0, 120));
      }
    } catch (e) {
      failed++;
      if (errors.length < 10) errors.push(e.message);
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  const remaining = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM photos WHERE (pinterest_pin_id IS NULL OR pinterest_pin_id='') AND published=1 AND r2_key IS NOT NULL AND r2_key != ''`
  ).first();
  return jsonRes({ posted, failed, errors, remaining: remaining?.cnt || 0 }, 200, request);
}
__name(handlePinterestSyncAll, "handlePinterestSyncAll");
async function handlePinterestSyncEn(request, env) {
  if (!await checkAuth(request, env)) return jsonRes({ error: "unauth" }, 401, request);
  const token = await getPinterestToken(env);
  if (!token) return jsonRes({ error: "Pinterest \u05DC\u05D0 \u05DE\u05D7\u05D5\u05D1\u05E8" }, 400, request);
  const limit = Math.min(parseInt(new URL(request.url).searchParams.get("limit") || "3"), 5);
  const { results } = await env.DB.prepare(
    `SELECT * FROM photos WHERE (pinterest_pin_id_en IS NULL OR pinterest_pin_id_en='') AND published=1 AND r2_key IS NOT NULL AND r2_key != '' ORDER BY created_at DESC LIMIT ?`
  ).bind(limit).all();
  let posted = 0, failed = 0;
  const errors = [];
  for (const photo of results) {
    try {
      const [boardIdEn, titleEn] = await Promise.all([
        findOrCreateBoardEn(photo.category, env, token),
        translateTitleEn(photo.title, photo.description, photo.category, env)
      ]);
      if (!boardIdEn) {
        failed++;
        errors.push(`no_en_board:${photo.category}`);
        continue;
      }
      const photoUrl = toAbsolutePhotoUrl(photo.url);
      const englishCategory = HE_TO_EN_CATEGORY[photo.category] || photo.category;
      const pinRes = await fetch("https://api.pinterest.com/v5/pins", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          link: `https://amitphotos.com/?photo=${photo.id}&buy=1`,
          title: titleEn || `${englishCategory} | Amit Erez`,
          description: `Fine art photography by Israeli photographer Amit Erez.
${englishCategory}. Available as high-quality prints at amitphotos.com.
#photography #${englishCategory.replace(/ /g, "").toLowerCase()} #fineartphotography #israeliphotographer #amiterezphotography`,
          board_id: boardIdEn,
          media_source: { source_type: "image_url", url: photoUrl }
        })
      });
      const pinData = await pinRes.json();
      if (pinData.id) {
        await env.DB.prepare(`UPDATE photos SET pinterest_pin_id_en=? WHERE id=?`).bind(pinData.id, photo.id).run();
        posted++;
      } else {
        failed++;
        if (errors.length < 5) errors.push(pinData.message || pinData.code || JSON.stringify(pinData).slice(0, 100));
      }
    } catch (e) {
      failed++;
      if (errors.length < 5) errors.push(e.message);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const remaining = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM photos WHERE (pinterest_pin_id_en IS NULL OR pinterest_pin_id_en='') AND published=1 AND r2_key IS NOT NULL AND r2_key != ''`
  ).first();
  return jsonRes({ posted, failed, errors, remaining: remaining?.cnt || 0 }, 200, request);
}
__name(handlePinterestSyncEn, "handlePinterestSyncEn");
async function handlePinterestUpdateLinks(request, env) {
  if (!await checkAuth(request, env)) return jsonRes({ error: "unauth" }, 401, request);
  const token = await getPinterestToken(env);
  if (!token) return jsonRes({ error: "Pinterest \u05DC\u05D0 \u05DE\u05D7\u05D5\u05D1\u05E8" }, 400, request);
  const { results } = await env.DB.prepare(
    `SELECT id, pinterest_pin_id FROM photos WHERE pinterest_pin_id IS NOT NULL AND pinterest_pin_id != '' AND published=1`
  ).all();
  let updated = 0, failed = 0;
  const errors = [];
  for (const photo of results) {
    try {
      const res = await fetch(`https://api.pinterest.com/v5/pins/${photo.pinterest_pin_id}`, {
        method: "PATCH",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ link: `https://amitphotos.com/?photo=${photo.id}&buy=1` })
      });
      if (res.ok) {
        updated++;
      } else {
        failed++;
        if (errors.length < 5) {
          const d = await res.json().catch(() => ({}));
          errors.push(d.message || res.status);
        }
      }
    } catch (e) {
      failed++;
      if (errors.length < 5) errors.push(e.message);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return jsonRes({ updated, failed, errors, total: results.length }, 200, request);
}
__name(handlePinterestUpdateLinks, "handlePinterestUpdateLinks");
async function storePinterestTokens(env, tokenData) {
  const { access_token, refresh_token, expires_in, refresh_token_expires_in } = tokenData;
  const expiresAt = Date.now() + (expires_in || 2592e3) * 1e3;
  const upsert = /* @__PURE__ */ __name((k, v) => env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).bind(k, String(v)).run(), "upsert");
  const ops = [
    upsert("pinterest_access_token", access_token),
    upsert("pinterest_token_expires_at", expiresAt)
  ];
  if (refresh_token) ops.push(upsert("pinterest_refresh_token", refresh_token));
  await Promise.all(ops);
}
__name(storePinterestTokens, "storePinterestTokens");
async function getPinterestToken(env) {
  const [tokenRow, expiryRow, refreshRow] = await Promise.all([
    env.DB.prepare("SELECT value FROM settings WHERE key='pinterest_access_token'").first(),
    env.DB.prepare("SELECT value FROM settings WHERE key='pinterest_token_expires_at'").first(),
    env.DB.prepare("SELECT value FROM settings WHERE key='pinterest_refresh_token'").first()
  ]);
  if (!tokenRow) return null;
  const expiresAt = parseInt(expiryRow?.value || "0");
  if (Date.now() < expiresAt - 6e4) return tokenRow.value;
  if (!refreshRow) return null;
  try {
    const credentials = btoa(`${env.PINTEREST_APP_ID}:${env.PINTEREST_APP_SECRET}`);
    const res = await fetch("https://api.pinterest.com/v5/oauth/token", {
      method: "POST",
      headers: { "Authorization": `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshRow.value })
    });
    const data = await res.json();
    if (!data.access_token) return null;
    await storePinterestTokens(env, data);
    return data.access_token;
  } catch {
    return null;
  }
}
__name(getPinterestToken, "getPinterestToken");
async function handlePinterestStatus(request, env) {
  if (!await checkAuth(request, env)) return jsonRes({ error: "unauth" }, 401, request);
  const token = await getPinterestToken(env);
  if (!token) return jsonRes({ connected: false }, 200, request);
  const [usernameRow, boardsRes] = await Promise.all([
    env.DB.prepare("SELECT value FROM settings WHERE key='pinterest_username'").first(),
    fetch("https://api.pinterest.com/v5/boards?page_size=50", { headers: { Authorization: `Bearer ${token}` } })
  ]);
  if (!boardsRes.ok) return jsonRes({ connected: false, expired: true }, 200, request);
  const boardsData = await boardsRes.json();
  return jsonRes({ connected: true, username: usernameRow?.value || "", boards: boardsData.items || [] }, 200, request);
}
__name(handlePinterestStatus, "handlePinterestStatus");
async function handlePinterestPost(request, env) {
  if (!await checkAuth(request, env)) return jsonRes({ error: "unauth" }, 401, request);
  const { photo_id, board_id, description } = await request.json();
  if (!photo_id || !board_id) return jsonRes({ error: "photo_id \u05D5-board_id \u05E0\u05D3\u05E8\u05E9\u05D9\u05DD" }, 400, request);
  const token = await getPinterestToken(env);
  if (!token) return jsonRes({ error: "Pinterest \u05DC\u05D0 \u05DE\u05D7\u05D5\u05D1\u05E8 \u2014 \u05D7\u05D1\u05E8 \u05D7\u05E9\u05D1\u05D5\u05DF \u05D1\u05D4\u05D2\u05D3\u05E8\u05D5\u05EA" }, 400, request);
  const photo = await env.DB.prepare("SELECT * FROM photos WHERE id=?").bind(photo_id).first();
  if (!photo) return jsonRes({ error: "\u05EA\u05DE\u05D5\u05E0\u05D4 \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D4" }, 404, request);
  const pinRes = await fetch("https://api.pinterest.com/v5/pins", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      link: `https://amitphotos.com/?photo=${photo_id}`,
      title: photo.title || "",
      description: description || (photo.description || "") + " | \u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6 \u05E6\u05D9\u05DC\u05D5\u05DD",
      board_id,
      media_source: { source_type: "image_url", url: toAbsolutePhotoUrl(photo.url) }
    })
  });
  const pinData = await pinRes.json();
  if (!pinRes.ok) return jsonRes({ error: pinData.message || "\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05D9\u05E6\u05D9\u05E8\u05EA \u05E4\u05D9\u05DF" }, 500, request);
  return jsonRes({ success: true, pin_id: pinData.id, pin_url: `https://www.pinterest.com/pin/${pinData.id}/` }, 200, request);
}
__name(handlePinterestPost, "handlePinterestPost");
async function handlePinterestBoards(request, env) {
  if (!await checkAuth(request, env)) return jsonRes({ error: "unauth" }, 401, request);
  const token = await getPinterestToken(env);
  if (!token) return jsonRes({ error: "Pinterest \u05DC\u05D0 \u05DE\u05D7\u05D5\u05D1\u05E8" }, 400, request);
  const boardsRes = await fetch("https://api.pinterest.com/v5/boards?page_size=50", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const boards = await boardsRes.json();
  return jsonRes({ boards: boards.items || [] }, 200, request);
}
__name(handlePinterestBoards, "handlePinterestBoards");
async function handlePinterestAuth(request, env) {
  const appId = env.PINTEREST_APP_ID;
  if (!appId) return new Response("PINTEREST_APP_ID \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8", { status: 500 });
  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/pinterest/callback`;
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "boards:read,boards:write,pins:read,pins:write,user_accounts:read",
    state: crypto.randomUUID()
  });
  return Response.redirect(`https://www.pinterest.com/oauth/?${params}`, 302);
}
__name(handlePinterestAuth, "handlePinterestAuth");
async function handlePinterestCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const origin = url.origin;
  const redirectUri = `${origin}/api/pinterest/callback`;
  if (error || !code) {
    return Response.redirect(`${origin}/admin.html?section=pinterest&pinterest_error=${encodeURIComponent(error || "no_code")}`, 302);
  }
  try {
    const credentials = btoa(`${env.PINTEREST_APP_ID}:${env.PINTEREST_APP_SECRET}`);
    const tokenRes = await fetch("https://api.pinterest.com/v5/oauth/token", {
      method: "POST",
      headers: { "Authorization": `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error(tokenData.message || "no token");
    await storePinterestTokens(env, tokenData);
    const userRes = await fetch("https://api.pinterest.com/v5/user_account", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
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
__name(handlePinterestCallback, "handlePinterestCallback");
var NL_GUIDE_SLUGS = [
  "lenses",
  "light",
  "exposure",
  "depth-of-field",
  "filters",
  "composition",
  "white-balance",
  "histogram",
  "dynamic-range",
  "editing",
  "software",
  "sports",
  "macro",
  "types",
  "visual-language",
  "controls",
  "landscape",
  "portrait",
  "focus"
];
var NL_GUIDE_TITLES = {
  "lenses": { he: "\u05E2\u05D3\u05E9\u05D5\u05EA", en: "Lenses" },
  "light": { he: "\u05D0\u05D5\u05E8 \u05D5\u05E6\u05D1\u05E2", en: "Light & Color" },
  "exposure": { he: "\u05D7\u05E9\u05D9\u05E4\u05D4", en: "Exposure" },
  "depth-of-field": { he: "\u05E2\u05D5\u05DE\u05E7 \u05E9\u05D3\u05D4", en: "Depth of Field" },
  "filters": { he: "\u05E4\u05D9\u05DC\u05D8\u05E8\u05D9\u05DD", en: "Filters" },
  "composition": { he: "\u05E7\u05D5\u05DE\u05E4\u05D5\u05D6\u05D9\u05E6\u05D9\u05D4", en: "Composition" },
  "white-balance": { he: "\u05D0\u05D9\u05D6\u05D5\u05DF \u05DC\u05D1\u05DF", en: "White Balance" },
  "histogram": { he: "\u05D4\u05D9\u05E1\u05D8\u05D5\u05D2\u05E8\u05DD", en: "Histogram" },
  "dynamic-range": { he: "\u05D8\u05D5\u05D5\u05D7 \u05D3\u05D9\u05E0\u05DE\u05D9", en: "Dynamic Range" },
  "editing": { he: "\u05E2\u05E8\u05D9\u05DB\u05D4 \u05D1\u05E1\u05D9\u05E1\u05D9\u05EA", en: "Basic Editing" },
  "software": { he: "\u05EA\u05D5\u05DB\u05E0\u05D5\u05EA \u05E2\u05E8\u05D9\u05DB\u05D4", en: "Editing Software" },
  "sports": { he: "\u05E1\u05E4\u05D5\u05E8\u05D8 \u05D5\u05EA\u05E0\u05D5\u05E2\u05D4", en: "Sports & Motion" },
  "macro": { he: "\u05E6\u05D9\u05DC\u05D5\u05DD \u05DE\u05D0\u05E7\u05E8\u05D5", en: "Macro Photography" },
  "types": { he: "\u05E1\u05D5\u05D2\u05D9 \u05DE\u05E6\u05DC\u05DE\u05D5\u05EA", en: "Camera Types" },
  "visual-language": { he: "\u05E9\u05E4\u05D4 \u05D5\u05D9\u05D6\u05D5\u05D0\u05DC\u05D9\u05EA", en: "Visual Language" },
  "controls": { he: "\u05DB\u05E4\u05EA\u05D5\u05E8\u05D9 \u05D4\u05DE\u05E6\u05DC\u05DE\u05D4", en: "Camera Controls" },
  "landscape": { he: "\u05DC\u05E0\u05D3\u05E1\u05E7\u05D9\u05D9\u05E4", en: "Landscape" },
  "portrait": { he: "\u05E4\u05D5\u05E8\u05D8\u05E8\u05D8", en: "Portrait" },
  "focus": { he: "\u05E4\u05D5\u05E7\u05D5\u05E1", en: "Focus Techniques" }
};
async function nlGetSetting(env, key) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(key).first();
  return row?.value ?? null;
}
__name(nlGetSetting, "nlGetSetting");
async function nlSetSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).bind(key, String(value)).run();
}
__name(nlSetSetting, "nlSetSetting");
async function nlPickHeroPhoto(env) {
  const lastId = await nlGetSetting(env, "nl_last_hero_id") || "";
  const row = await env.DB.prepare(
    `SELECT id, title, url, thumbnail, category FROM photos WHERE id != ? AND published=1 ORDER BY created_at DESC LIMIT 1`
  ).bind(lastId).first();
  return row || null;
}
__name(nlPickHeroPhoto, "nlPickHeroPhoto");
async function nlPickGuide(env) {
  const raw = await nlGetSetting(env, "nl_guide_index");
  const idx = parseInt(raw || "0", 10) || 0;
  const slug = NL_GUIDE_SLUGS[idx % NL_GUIDE_SLUGS.length];
  return { slug, idx, ...NL_GUIDE_TITLES[slug] };
}
__name(nlPickGuide, "nlPickGuide");
async function nlPickLocation(env) {
  const raw = await nlGetSetting(env, "nl_location_index");
  const idx = parseInt(raw || "0", 10) || 0;
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
    "SELECT url, thumbnail FROM location_photos WHERE location_id = ? ORDER BY sort_order ASC LIMIT 4"
  ).bind(loc.id).all();
  loc.photos = (locPhotos || []).map((p) => toAbsolutePhotoUrl(p.url || p.thumbnail));
  return loc;
}
__name(nlPickLocation, "nlPickLocation");
async function nlPickGalleryPhotos(env, heroPhotoId, heroCategory) {
  if (heroCategory) {
    const { results: samecat } = await env.DB.prepare(
      "SELECT id, title, url FROM photos WHERE published=1 AND id != ? AND category=? ORDER BY RANDOM() LIMIT 3"
    ).bind(heroPhotoId, heroCategory).all();
    if ((samecat || []).length >= 2)
      return samecat.map((p) => ({ id: p.id, title: p.title || "", url: toAbsolutePhotoUrl(p.url) }));
  }
  const { results } = await env.DB.prepare(
    "SELECT id, title, url FROM photos WHERE published=1 AND id != ? ORDER BY RANDOM() LIMIT 3"
  ).bind(heroPhotoId).all();
  return (results || []).map((p) => ({ id: p.id, title: p.title || "", url: toAbsolutePhotoUrl(p.url) }));
}
__name(nlPickGalleryPhotos, "nlPickGalleryPhotos");
async function nlPickNewPhotos(env, heroPhotoId) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1e3).toISOString();
  const { results } = await env.DB.prepare(
    "SELECT id, title, url, thumbnail, category FROM photos WHERE published=1 AND id != ? AND created_at >= ? ORDER BY created_at DESC LIMIT 6"
  ).bind(heroPhotoId, cutoff).all();
  return (results || []).map((p) => ({
    id: p.id,
    title: p.title || "",
    url: toAbsolutePhotoUrl(p.url || p.thumbnail),
    category: p.category || ""
  }));
}
__name(nlPickNewPhotos, "nlPickNewPhotos");
async function nlGenerateContent(env, heroPhoto, guide, location, type) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  let userPrompt;
  if (type === "full") {
    userPrompt = `\u05DB\u05EA\u05D5\u05D1 \u05EA\u05D5\u05DB\u05DF \u05DC\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8 \u05E6\u05D9\u05DC\u05D5\u05DD \u05D7\u05D5\u05D3\u05E9\u05D9. \u05D4\u05D7\u05D6\u05E8 JSON \u05D1\u05DC\u05D1\u05D3 (\u05DC\u05DC\u05D0 markdown), \u05E2\u05DD \u05D4\u05E9\u05D3\u05D5\u05EA \u05D4\u05D1\u05D0\u05D9\u05DD:

{
  "hero_text_he": "\u05E4\u05E1\u05E7\u05D4 \u05E7\u05E6\u05E8\u05D4 (2-3 \u05DE\u05E9\u05E4\u05D8\u05D9\u05DD) \u05D1\u05E2\u05D1\u05E8\u05D9\u05EA \u05EA\u05E7\u05E0\u05D9\u05EA \u05E2\u05DC \u05D4\u05EA\u05DE\u05D5\u05E0\u05D4",
  "hero_text_en": "same paragraph in English",
  "guide_text_he": "2 \u05DE\u05E9\u05E4\u05D8\u05D9\u05DD \u05DE\u05E2\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD \u05E2\u05DC \u05D4\u05DE\u05D3\u05E8\u05D9\u05DA \u05D4\u05D6\u05D4",
  "guide_text_en": "same in English",
  "location_text_he": "2-3 \u05DE\u05E9\u05E4\u05D8\u05D9\u05DD \u05E2\u05DC \u05D4\u05DE\u05E7\u05D5\u05DD \u2014 \u05DE\u05D4 \u05DE\u05D9\u05D5\u05D7\u05D3 \u05D1\u05D5, \u05DE\u05EA\u05D9 \u05DC\u05DC\u05DB\u05EA",
  "location_text_en": "same in English",
  "tip_title_he": "\u05DB\u05D5\u05EA\u05E8\u05EA \u05E7\u05E6\u05E8\u05D4 \u05DC\u05D8\u05D9\u05E4 (5-7 \u05DE\u05D9\u05DC\u05D9\u05DD)",
  "tip_title_en": "short tip title in English",
  "tip_text_he": "\u05D8\u05D9\u05E4 \u05E6\u05D9\u05DC\u05D5\u05DD \u05E9\u05DC\u05D0 \u05E7\u05D9\u05D9\u05DD \u05D1\u05D0\u05EA\u05E8 \u2014 \u05DE\u05E7\u05D5\u05E8\u05D9, \u05E4\u05E8\u05E7\u05D8\u05D9, 2-3 \u05DE\u05E9\u05E4\u05D8\u05D9\u05DD",
  "tip_text_en": "same tip in English",
  "guide_steps": [
    {"num": 1, "title_he": "\u05E9\u05DD \u05D4\u05E9\u05DC\u05D1 (3-5 \u05DE\u05D9\u05DC\u05D9\u05DD)", "title_en": "step name", "text_he": "\u05D4\u05E1\u05D1\u05E8 \u05E7\u05E6\u05E8 (2-3 \u05DE\u05E9\u05E4\u05D8\u05D9\u05DD)", "text_en": "same in English"},
    {"num": 2, "title_he": "...", "title_en": "...", "text_he": "...", "text_en": "..."},
    {"num": 3, "title_he": "...", "title_en": "...", "text_he": "...", "text_en": "..."}
  ]
}

\u05E4\u05E8\u05D8\u05D9\u05DD \u05DC\u05EA\u05D5\u05DB\u05DF:
- \u05EA\u05DE\u05D5\u05E0\u05D4: "${heroPhoto.title}" (\u05E7\u05D8\u05D2\u05D5\u05E8\u05D9\u05D4: ${heroPhoto.category || "\u05D8\u05D1\u05E2"})
- \u05DE\u05D3\u05E8\u05D9\u05DA: "${guide.he}"
- \u05DE\u05E7\u05D5\u05DD: "${location.title}" \u2014 ${location.description || ""} \u2014 \u05D4\u05D6\u05DE\u05DF \u05D4\u05D8\u05D5\u05D1: ${location.best_time || "\u05DC\u05D0 \u05E6\u05D5\u05D9\u05DF"}`;
  } else {
    userPrompt = `\u05DB\u05EA\u05D5\u05D1 \u05EA\u05D5\u05DB\u05DF \u05DC\u05D4\u05D1\u05D6\u05E7 \u2014 \u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8 \u05E7\u05E6\u05E8 \u05D5\u05DE\u05D4\u05D9\u05E8. \u05DB\u05EA\u05D5\u05D1 \u05D1\u05D2\u05D5\u05E3 \u05E8\u05D0\u05E9\u05D5\u05DF, \u05DB\u05D0\u05D9\u05DC\u05D5 \u05E2\u05DE\u05D9\u05EA \u05E9\u05D5\u05DC\u05D7 \u05D4\u05D5\u05D3\u05E2\u05D4 \u05E1\u05E4\u05D5\u05E0\u05D8\u05E0\u05D9\u05EA \u05DC\u05D7\u05D1\u05E8\u05D9\u05DD. \u05D4\u05D7\u05D6\u05E8 JSON \u05D1\u05DC\u05D1\u05D3:

{
  "hero_text_he": "1-2 \u05DE\u05E9\u05E4\u05D8\u05D9\u05DD \u05D0\u05D9\u05E9\u05D9\u05D9\u05DD \u2014 \u05DE\u05D4 \u05D0\u05E0\u05D9 \u05DE\u05E8\u05D2\u05D9\u05E9 \u05DB\u05DC\u05E4\u05D9 \u05D4\u05EA\u05DE\u05D5\u05E0\u05D4 \u05D4\u05D6\u05D5, \u05D0\u05D5 \u05DE\u05D4 \u05E7\u05E8\u05D4 \u05D1\u05E8\u05D2\u05E2 \u05D4\u05E6\u05D9\u05DC\u05D5\u05DD",
  "hero_text_en": "same in English",
  "tip_text_he": "\u05D8\u05D9\u05E4 \u05D0\u05D7\u05D3 \u05E9\u05D9\u05DE\u05D5\u05E9\u05D9 \u05E9\u05D0\u05E0\u05D9 \u05E2\u05E6\u05DE\u05D9 \u05DE\u05E9\u05EA\u05DE\u05E9 \u05D1\u05D5 \u2014 \u05E7\u05E6\u05E8, \u05E1\u05E4\u05E6\u05D9\u05E4\u05D9, \u05DC\u05D0 \u05DB\u05DC\u05DC\u05D9",
  "tip_text_en": "same in English"
}

\u05EA\u05DE\u05D5\u05E0\u05D4: "${heroPhoto.title}" (\u05E7\u05D8\u05D2\u05D5\u05E8\u05D9\u05D4: ${heroPhoto.category || "\u05D8\u05D1\u05E2"})`;
  }
  const reqBody = JSON.stringify({
    model: "claude-opus-4-7",
    max_tokens: 3500,
    system: '\u05D0\u05EA\u05D4 \u05DB\u05D5\u05EA\u05D1 \u05D1\u05E9\u05DE\u05D5 \u05E9\u05DC \u05E2\u05DE\u05D9\u05EA, \u05E6\u05DC\u05DD \u05D9\u05E9\u05E8\u05D0\u05DC\u05D9. \u05DB\u05EA\u05D5\u05D1 \u05EA\u05DE\u05D9\u05D3 \u05D1\u05D2\u05D5\u05E3 \u05E8\u05D0\u05E9\u05D5\u05DF ("\u05D0\u05E0\u05D9", "\u05DC\u05D9", "\u05E9\u05DC\u05D9", "\u05E6\u05D9\u05DC\u05DE\u05EA\u05D9"). \u05D8\u05D5\u05DF \u05D0\u05D9\u05E9\u05D9 \u05D5\u05D7\u05DD, \u05DB\u05D0\u05D9\u05DC\u05D5 \u05E2\u05DE\u05D9\u05EA \u05DB\u05D5\u05EA\u05D1 \u05DC\u05D7\u05D1\u05E8\u05D9\u05DD \u05E7\u05E8\u05D5\u05D1\u05D9\u05DD \u05E9\u05D0\u05D5\u05D4\u05D1\u05D9\u05DD \u05E6\u05D9\u05DC\u05D5\u05DD \u2014 \u05DC\u05D0 \u05E9\u05D9\u05D5\u05D5\u05E7\u05D9, \u05DC\u05D0 \u05E4\u05D5\u05E8\u05DE\u05DC\u05D9, \u05D0\u05DE\u05D9\u05EA\u05D9. \u05D4\u05D7\u05D6\u05E8 JSON \u05EA\u05E7\u05D9\u05DF \u05D1\u05DC\u05D1\u05D3, \u05DC\u05DC\u05D0 \u05E9\u05D5\u05DD \u05D8\u05E7\u05E1\u05D8 \u05E0\u05D5\u05E1\u05E3.',
    messages: [{ role: "user", content: userPrompt }]
  });
  const reqHeaders = { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" };
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 3e3));
    res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: reqHeaders, body: reqBody });
    if (res.status !== 529) break;
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const raw = (data.content?.[0]?.text ?? "").trim();
  if (!raw) throw new Error("Claude returned empty response");
  const jsonStr = raw.startsWith("```") ? raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "") : raw;
  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new Error(`Claude JSON parse failed: ${jsonStr.slice(0, 100)}`);
  }
}
__name(nlGenerateContent, "nlGenerateContent");
async function nlGenerateDraft(env, type, monthOverride) {
  const rawNum = await nlGetSetting(env, "nl_issue_number");
  const issueNumber = parseInt(rawNum || "0", 10) + 1;
  const now = monthOverride ? /* @__PURE__ */ new Date(monthOverride + "-01") : /* @__PURE__ */ new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const slug = `${monthStr}-${type}`;
  const existing = await env.DB.prepare("SELECT id FROM newsletter_issues WHERE slug=?").bind(slug).first();
  if (existing) return { skipped: true, slug };
  const heroPhoto = await nlPickHeroPhoto(env);
  if (!heroPhoto) throw new Error("No photos found");
  const galleryPhotos = await nlPickGalleryPhotos(env, heroPhoto.id, heroPhoto.category);
  const newPhotos = await nlPickNewPhotos(env, heroPhoto.id);
  const guide = await nlPickGuide(env);
  const location = type === "full" ? await nlPickLocation(env) : null;
  const generated = await nlGenerateContent(env, heroPhoto, guide, location, type);
  const photoUrl = toAbsolutePhotoUrl(heroPhoto.url || heroPhoto.thumbnail);
  const content = type === "full" ? {
    hero: {
      photo_id: heroPhoto.id,
      photo_url: photoUrl,
      title_he: heroPhoto.title,
      category: heroPhoto.category || "",
      text_he: generated.hero_text_he,
      text_en: generated.hero_text_en
    },
    guide: {
      slug: guide.slug,
      title_he: guide.he,
      title_en: guide.en,
      text_he: generated.guide_text_he,
      text_en: generated.guide_text_en,
      steps: Array.isArray(generated.guide_steps) ? generated.guide_steps : []
    },
    location: location ? {
      id: location.id,
      title_he: location.title,
      text_he: generated.location_text_he,
      text_en: generated.location_text_en,
      photos: location.photos || []
    } : null,
    tip: {
      title_he: generated.tip_title_he,
      title_en: generated.tip_title_en,
      text_he: generated.tip_text_he,
      text_en: generated.tip_text_en
    },
    gallery_photos: galleryPhotos,
    new_photos: newPhotos,
    links: [
      { label_he: "\u05D2\u05DC\u05E8\u05D9\u05D4", label_en: "Gallery", url: "/" },
      { label_he: "\u05DE\u05D3\u05E8\u05D9\u05DB\u05D9\u05DD", label_en: "Guides", url: "/camera/" },
      { label_he: "\u05DE\u05E7\u05D5\u05DE\u05D5\u05EA", label_en: "Locations", url: "/locations/" },
      { label_he: "\u05E0\u05D9\u05EA\u05D5\u05D7\u05D9 \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA", label_en: "Photo Analyses", url: "/learn/" }
    ]
  } : {
    hero: {
      photo_id: heroPhoto.id,
      photo_url: photoUrl,
      title_he: heroPhoto.title,
      category: heroPhoto.category || "",
      text_he: generated.hero_text_he,
      text_en: generated.hero_text_en
    },
    tip: { text_he: generated.tip_text_he, text_en: generated.tip_text_en },
    gallery_photos: galleryPhotos,
    new_photos: newPhotos
  };
  const titleHe = type === "full" ? `\u05D2\u05D9\u05DC\u05D9\u05D5\u05DF #${issueNumber} \u2014 ${["\u05D9\u05E0\u05D5\u05D0\u05E8", "\u05E4\u05D1\u05E8\u05D5\u05D0\u05E8", "\u05DE\u05E8\u05E5", "\u05D0\u05E4\u05E8\u05D9\u05DC", "\u05DE\u05D0\u05D9", "\u05D9\u05D5\u05E0\u05D9", "\u05D9\u05D5\u05DC\u05D9", "\u05D0\u05D5\u05D2\u05D5\u05E1\u05D8", "\u05E1\u05E4\u05D8\u05DE\u05D1\u05E8", "\u05D0\u05D5\u05E7\u05D8\u05D5\u05D1\u05E8", "\u05E0\u05D5\u05D1\u05DE\u05D1\u05E8", "\u05D3\u05E6\u05DE\u05D1\u05E8"][now.getMonth()]} ${now.getFullYear()}` : `\u05D4\u05D1\u05D6\u05E7 \u2014 ${["\u05D9\u05E0\u05D5\u05D0\u05E8", "\u05E4\u05D1\u05E8\u05D5\u05D0\u05E8", "\u05DE\u05E8\u05E5", "\u05D0\u05E4\u05E8\u05D9\u05DC", "\u05DE\u05D0\u05D9", "\u05D9\u05D5\u05E0\u05D9", "\u05D9\u05D5\u05DC\u05D9", "\u05D0\u05D5\u05D2\u05D5\u05E1\u05D8", "\u05E1\u05E4\u05D8\u05DE\u05D1\u05E8", "\u05D0\u05D5\u05E7\u05D8\u05D5\u05D1\u05E8", "\u05E0\u05D5\u05D1\u05DE\u05D1\u05E8", "\u05D3\u05E6\u05DE\u05D1\u05E8"][now.getMonth()]} ${now.getFullYear()}`;
  const titleEn = type === "full" ? `Issue #${issueNumber} \u2014 ${now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}` : `Flash \u2014 ${now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO newsletter_issues (id, slug, type, issue_number, title_he, title_en, content_json, status, created_at)
     VALUES (?,?,?,?,?,?,?,'draft',?)`
  ).bind(id, slug, type, issueNumber, titleHe, titleEn, JSON.stringify(content), now.toISOString()).run();
  if (type === "full") {
    await nlSetSetting(env, "nl_last_hero_id", heroPhoto.id);
    await nlSetSetting(env, "nl_guide_index", String((guide.idx + 1) % NL_GUIDE_SLUGS.length));
    if (location) {
      const { results: total } = await env.DB.prepare("SELECT COUNT(*) as c FROM locations WHERE published=1").all();
      const totalLocs = total[0]?.c || 1;
      await nlSetSetting(env, "nl_location_index", String((location.idx + 1) % totalLocs));
    }
    await nlSetSetting(env, "nl_issue_number", String(issueNumber));
  }
  return { id, slug, issueNumber };
}
__name(nlGenerateDraft, "nlGenerateDraft");
async function runNewsletterCron(env) {
  const day = (/* @__PURE__ */ new Date()).getDate();
  const type = day <= 2 ? "full" : "flash";
  try {
    const result = await nlGenerateDraft(env, type);
    console.log("[newsletter cron]", result.skipped ? "skipped" : `draft created: ${result.slug}`);
  } catch (e) {
    console.error("[newsletter cron] error:", e.message);
  }
}
__name(runNewsletterCron, "runNewsletterCron");
async function handleNlList(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, slug, type, issue_number, title_he, published_at, content_json
     FROM newsletter_issues WHERE status='published' ORDER BY published_at DESC LIMIT 24`
  ).all();
  const cards = (results || []).map((issue) => {
    const c = JSON.parse(issue.content_json || "{}");
    const thumb = c.hero?.photo_url || "";
    const badge = issue.type === "full" ? "\u05D2\u05D9\u05DC\u05D9\u05D5\u05DF \u05DE\u05DC\u05D0" : "\u05D4\u05D1\u05D6\u05E7";
    const badgeEn = issue.type === "full" ? "Full Issue" : "Flash";
    const date = issue.published_at ? issue.published_at.slice(0, 10) : "";
    return `<a class="nl-card" href="/newsletter/${escXml(issue.slug)}/">
      ${thumb ? `<img src="${escXml(thumb)}" alt="${escXml(issue.title_he)}" loading="lazy">` : '<div class="nl-card-placeholder"></div>'}
      <div class="nl-card-body">
        <span class="nl-badge" data-he="${escXml(badge)}" data-en="${escXml(badgeEn)}">${escXml(badge)}</span>
        <div class="nl-card-title">${escXml(issue.title_he)}</div>
        <div class="nl-card-date">${escXml(date)}</div>
      </div>
    </a>`;
  }).join("\n");
  const empty = !results?.length ? '<p style="text-align:center;color:#888;padding:4rem">\u05D4\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8 \u05D4\u05E8\u05D0\u05E9\u05D5\u05DF \u05D9\u05E4\u05D5\u05E8\u05E1\u05DD \u05D1\u05E7\u05E8\u05D5\u05D1</p>' : "";
  return htmlRes(`<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8 | Amit Photos</title>
<link rel="canonical" href="https://amitphotos.com/newsletter/">
${GA_SNIPPET}
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
<script src="/assets/js/nav.js" defer><\/script>
</head>
<body>
<div class="page-hero">
  <h1 data-he="\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8" data-en="Newsletter">\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8</h1>
  <p data-he="\u05D2\u05D9\u05DC\u05D9\u05D5\u05E0\u05D5\u05EA \u05D7\u05D5\u05D3\u05E9\u05D9\u05D9\u05DD \u2014 \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA, \u05DE\u05D3\u05E8\u05D9\u05DB\u05D9\u05DD \u05D5\u05DE\u05E7\u05D5\u05DE\u05D5\u05EA \u05E6\u05D9\u05DC\u05D5\u05DD" data-en="Monthly issues \u2014 photos, guides and shooting locations">\u05D2\u05D9\u05DC\u05D9\u05D5\u05E0\u05D5\u05EA \u05D7\u05D5\u05D3\u05E9\u05D9\u05D9\u05DD \u2014 \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA, \u05DE\u05D3\u05E8\u05D9\u05DB\u05D9\u05DD \u05D5\u05DE\u05E7\u05D5\u05DE\u05D5\u05EA \u05E6\u05D9\u05DC\u05D5\u05DD</p>
</div>
<div class="nl-grid">${cards}${empty}</div>
<script>
function getLang(){return localStorage.getItem('lang')||'he'}
function applyLang(){const lang=getLang(),isEn=lang==='en';document.documentElement.dir=isEn?'ltr':'rtl';document.documentElement.lang=lang;document.body.style.direction=isEn?'ltr':'rtl';document.querySelectorAll('[data-he]').forEach(el=>{el.innerHTML=isEn?(el.dataset.en||el.dataset.he):el.dataset.he})}
applyLang();window.setLang=applyLang;window.addEventListener('storage',e=>{if(e.key==='lang')applyLang()})
<\/script>
</body></html>`, 200, "no-cache");
}
__name(handleNlList, "handleNlList");
async function handleNlIssue(env, slug, isPreview) {
  const issue = await env.DB.prepare(
    `SELECT * FROM newsletter_issues WHERE slug=?${isPreview ? "" : " AND status='published'"}`
  ).bind(slug).first();
  if (!issue) return new Response("Not found", { status: 404 });
  const c = JSON.parse(issue.content_json || "{}");
  const isFull = issue.type === "full";
  const dateStr = issue.published_at ? issue.published_at.slice(0, 10) : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const pageUrl = `https://amitphotos.com/newsletter/${slug}/`;
  const waHref = escXml(`https://wa.me/?text=${encodeURIComponent(issue.title_he + " \u2014 " + pageUrl)}`);
  const heroPriceHtml = c.sale?.sale_price ? `
      <div class="nl-hero-price">
        <span class="nl-hero-price-orig">${escXml(c.sale.original_price || "")}</span>
        <span class="nl-hero-price-sale">${escXml(c.sale.sale_price)}</span>
      </div>` : "";
  const heroSection = c.hero ? `
    <section class="nl-section nl-hero-section">
      <a href="/?photo=${escXml(c.hero.photo_id)}" style="display:block;text-decoration:none">
        <img src="${escXml(c.hero.photo_url)}" alt="${escXml(c.hero.title_he)}" class="nl-hero-img">
      </a>
      <h2 class="nl-photo-title" data-he="${escXml(c.hero.title_he)}" data-en="${escXml(c.hero.title_he)}">${escXml(c.hero.title_he)}</h2>
      <p class="nl-body-text" data-he="${escXml(c.hero.text_he)}" data-en="${escXml(c.hero.text_en || c.hero.text_he)}">${escXml(c.hero.text_he)}</p>
      <div class="nl-hero-footer">${heroPriceHtml}<a class="nl-btn-secondary nl-hero-order" href="/?photo=${escXml(c.hero.photo_id)}" data-he="\u05E8\u05DB\u05D5\u05E9 \u05E7\u05D5\u05D1\u05E5 \u2190" data-en="Buy File \u2192">\u05E8\u05DB\u05D5\u05E9 \u05E7\u05D5\u05D1\u05E5 \u2190</a></div>
    </section>` : "";
  const guideSection = isFull && c.guide ? (() => {
    const hasSteps = Array.isArray(c.guide.steps) && c.guide.steps.length > 0;
    if (hasSteps) {
      const pillsHtml = c.guide.steps.map(
        (s, i) => `<button class="nl-step-pill${i === 0 ? " nl-step-active" : ""}" onclick="showStep(${i + 1})">
          <span class="nl-step-num">${String(i + 1).padStart(2, "0")}</span>
          <span class="nl-step-label" data-he="${escXml(s.title_he)}" data-en="${escXml(s.title_en || s.title_he)}">${escXml(s.title_he)}</span>
        </button>`
      ).join("");
      const heroThumb = c.hero?.photo_url || "";
      const _stepOverlays = [
        `<svg class="nl-vis-svg" viewBox="0 0 300 200" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="100" y1="0" x2="100" y2="200" stroke="rgba(200,169,110,.55)" stroke-width="1.5"/><line x1="200" y1="0" x2="200" y2="200" stroke="rgba(200,169,110,.55)" stroke-width="1.5"/><line x1="0" y1="67" x2="300" y2="67" stroke="rgba(200,169,110,.55)" stroke-width="1.5"/><line x1="0" y1="133" x2="300" y2="133" stroke="rgba(200,169,110,.55)" stroke-width="1.5"/><circle cx="100" cy="67" r="5" fill="rgba(200,169,110,.85)"/><circle cx="200" cy="67" r="5" fill="rgba(200,169,110,.85)"/><circle cx="100" cy="133" r="5" fill="rgba(200,169,110,.85)"/><circle cx="200" cy="133" r="5" fill="rgba(200,169,110,.85)"/></svg>`,
        `<svg class="nl-vis-svg" viewBox="0 0 300 200" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><marker id="nl-arr" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto"><polygon points="0,0 7,3.5 0,7" fill="rgba(200,169,110,.85)"/></marker></defs><line x1="15" y1="195" x2="190" y2="78" stroke="rgba(200,169,110,.7)" stroke-width="1.5" marker-end="url(#nl-arr)"/><line x1="70" y1="200" x2="190" y2="78" stroke="rgba(200,169,110,.5)" stroke-width="1.5" marker-end="url(#nl-arr)"/><line x1="0" y1="150" x2="190" y2="78" stroke="rgba(200,169,110,.35)" stroke-width="1.5" marker-end="url(#nl-arr)"/><circle cx="190" cy="78" r="7" stroke="rgba(200,169,110,.9)" stroke-width="1.5"/></svg>`,
        `<svg class="nl-vis-svg" viewBox="0 0 300 200" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="48" height="200" fill="rgba(0,0,0,.32)"/><rect x="252" y="0" width="48" height="200" fill="rgba(0,0,0,.32)"/><rect x="0" y="0" width="300" height="36" fill="rgba(0,0,0,.32)"/><rect x="0" y="164" width="300" height="36" fill="rgba(0,0,0,.32)"/><path d="M20,20 L20,48 M20,20 L48,20" stroke="rgba(200,169,110,.9)" stroke-width="2.5" stroke-linecap="round"/><path d="M280,20 L280,48 M280,20 L252,20" stroke="rgba(200,169,110,.9)" stroke-width="2.5" stroke-linecap="round"/><path d="M20,180 L20,152 M20,180 L48,180" stroke="rgba(200,169,110,.9)" stroke-width="2.5" stroke-linecap="round"/><path d="M280,180 L280,152 M280,180 L252,180" stroke="rgba(200,169,110,.9)" stroke-width="2.5" stroke-linecap="round"/></svg>`
      ];
      const stepsHtml = c.guide.steps.map(
        (s, i) => `<div class="nl-step-content" id="step-${i + 1}"${i > 0 ? ' style="display:none"' : ""}>
          <div class="nl-step-body">
            <div class="nl-step-info">
              <div class="nl-step-num-bg">${String(i + 1).padStart(2, "0")}</div>
              <h3 class="nl-step-title" data-he="${escXml(s.title_he)}" data-en="${escXml(s.title_en || s.title_he)}">${escXml(s.title_he)}</h3>
              <p class="nl-body-text" data-he="${escXml(s.text_he)}" data-en="${escXml(s.text_en || s.text_he)}">${escXml(s.text_he)}</p>
            </div>
            ${heroThumb ? `<div class="nl-step-vis"><div class="nl-vis-wrap"><img src="${escXml(heroThumb)}" class="nl-vis-img" loading="lazy" alt="">${_stepOverlays[i] || _stepOverlays[0]}</div></div>` : ""}
          </div>
        </div>`
      ).join("");
      const guideCtaBanner = `
      <a class="nl-guide-cta-banner" href="/camera/${escXml(c.guide.slug)}/">
        <div class="nl-guide-cta-text">
          <div class="nl-guide-cta-label" data-he="\u05D4\u05DE\u05D3\u05E8\u05D9\u05DA \u05D4\u05DE\u05DC\u05D0 \u05D1\u05D0\u05EA\u05E8" data-en="Full Guide on Site">\u05D4\u05DE\u05D3\u05E8\u05D9\u05DA \u05D4\u05DE\u05DC\u05D0 \u05D1\u05D0\u05EA\u05E8</div>
          <div class="nl-guide-cta-title" data-he="${escXml(c.guide.title_he)}" data-en="${escXml(c.guide.title_en || c.guide.title_he)}">${escXml(c.guide.title_he)}</div>
        </div>
        <span class="nl-guide-cta-arrow" data-he="\u2190" data-en="\u2192">\u2190</span>
      </a>`;
      return `
    <section class="nl-section nl-guide-section">
      <div class="nl-section-badge" data-he="\u05DE\u05D3\u05E8\u05D9\u05DA \u05D4\u05D7\u05D5\u05D3\u05E9" data-en="Guide of the Month">\u05DE\u05D3\u05E8\u05D9\u05DA \u05D4\u05D7\u05D5\u05D3\u05E9</div>
      <h2 class="nl-section-title" data-he="${escXml(c.guide.title_he)}" data-en="${escXml(c.guide.title_en || c.guide.title_he)}">${escXml(c.guide.title_he)}</h2>
      <div class="nl-steps-nav">${pillsHtml}</div>
      ${stepsHtml}
      ${guideCtaBanner}
    </section>`;
    } else {
      return `
    <section class="nl-section nl-guide-section">
      <div class="nl-section-badge" data-he="\u05DE\u05D3\u05E8\u05D9\u05DA \u05D4\u05D7\u05D5\u05D3\u05E9" data-en="Guide of the Month">\u05DE\u05D3\u05E8\u05D9\u05DA \u05D4\u05D7\u05D5\u05D3\u05E9</div>
      <h2 class="nl-section-title" data-he="${escXml(c.guide.title_he)}" data-en="${escXml(c.guide.title_en || c.guide.title_he)}">${escXml(c.guide.title_he)}</h2>
      <p class="nl-body-text" data-he="${escXml(c.guide.text_he)}" data-en="${escXml(c.guide.text_en || c.guide.text_he)}">${escXml(c.guide.text_he)}</p>
      <a class="nl-guide-cta-banner" href="/camera/${escXml(c.guide.slug)}/">
        <div class="nl-guide-cta-text">
          <div class="nl-guide-cta-label">\u05D4\u05DE\u05D3\u05E8\u05D9\u05DA \u05D4\u05DE\u05DC\u05D0 \u05D1\u05D0\u05EA\u05E8</div>
          <div class="nl-guide-cta-title">${escXml(c.guide.title_he)}</div>
        </div>
        <span class="nl-guide-cta-arrow">\u2190</span>
      </a>
    </section>`;
    }
  })() : "";
  const locationSection = isFull && c.location ? (() => {
    const lPhotos = Array.isArray(c.location.photos) ? c.location.photos.filter(Boolean) : [];
    const mainPhoto = lPhotos[0] || "";
    const stripPhotos = lPhotos.slice(1, 4);
    return `
    <section class="nl-section nl-location-section">
      <div class="nl-section-badge" data-he="\u05DE\u05E7\u05D5\u05DD \u05DC\u05E6\u05D9\u05DC\u05D5\u05DD" data-en="Photo Location">\u05DE\u05E7\u05D5\u05DD \u05DC\u05E6\u05D9\u05DC\u05D5\u05DD</div>
      <h2 class="nl-section-title" data-he="${escXml(c.location.title_he)}" data-en="${escXml(c.location.title_he)}">${escXml(c.location.title_he)}</h2>
      ${mainPhoto ? `<div class="nl-loc-photos">
        <a href="/locations/${escXml(c.location.id || "")}/" style="display:block;text-decoration:none">
          <img src="${escXml(mainPhoto)}" alt="${escXml(c.location.title_he)}" class="nl-loc-main-img" loading="lazy">
        </a>
        ${stripPhotos.length ? `<div class="nl-loc-strip">${stripPhotos.map(
      (u) => `<a href="/locations/${escXml(c.location.id || "")}/" style="text-decoration:none"><img src="${escXml(u)}" alt="" class="nl-loc-strip-img" loading="lazy"></a>`
    ).join("")}</div>` : ""}
      </div>` : ""}
      <p class="nl-body-text" data-he="${escXml(c.location.text_he)}" data-en="${escXml(c.location.text_en || c.location.text_he)}">${escXml(c.location.text_he)}</p>
      <div class="nl-location-links">
        <a class="nl-location-btn" href="/locations/">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          <span data-he="\u05DC\u05DB\u05DC \u05D4\u05DE\u05E7\u05D5\u05DE\u05D5\u05EA" data-en="All Locations">\u05DC\u05DB\u05DC \u05D4\u05DE\u05E7\u05D5\u05DE\u05D5\u05EA</span>
        </a>
        <a class="nl-location-btn" href="https://www.google.com/maps/search/${encodeURIComponent(c.location.title_he)}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
          <span data-he="\u05E4\u05EA\u05D7 \u05D1\u05DE\u05E4\u05D4" data-en="Open in Maps">\u05E4\u05EA\u05D7 \u05D1\u05DE\u05E4\u05D4</span>
        </a>
      </div>
    </section>`;
  })() : "";
  const tipSection = c.tip ? `
    <section class="nl-section nl-tip-section">
      <div class="nl-tip-card">
        <div class="nl-tip-header">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="nl-tip-icon"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>
          <div class="nl-tip-title" data-he="${escXml(c.tip.title_he || "\u05D8\u05D9\u05E4 \u05D4\u05D7\u05D5\u05D3\u05E9")}" data-en="${escXml(c.tip.title_en || "Tip of the Month")}">${escXml(c.tip.title_he || "\u05D8\u05D9\u05E4 \u05D4\u05D7\u05D5\u05D3\u05E9")}</div>
        </div>
        <div class="nl-tip-grid">
          <div>
            <p class="nl-tip-text" data-he="${escXml(c.tip.text_he)}" data-en="${escXml(c.tip.text_en || c.tip.text_he)}">${escXml(c.tip.text_he)}</p>
            <a class="nl-link nl-tip-more" href="/camera/" data-he="\u05DC\u05D8\u05D9\u05E4\u05D9\u05DD \u05E0\u05D5\u05E1\u05E4\u05D9\u05DD \u05D5\u05DE\u05D3\u05E8\u05D9\u05DB\u05D9\u05DD \u2190" data-en="More Tips & Guides \u2192">\u05DC\u05D8\u05D9\u05E4\u05D9\u05DD \u05E0\u05D5\u05E1\u05E4\u05D9\u05DD \u05D5\u05DE\u05D3\u05E8\u05D9\u05DB\u05D9\u05DD \u2190</a>
          </div>
          ${c.tip?.photo_url || c.hero?.photo_url ? `<a class="nl-tip-img-wrap" href="${escXml(c.tip?.photo_url ? "/locations/" : "/?photo=" + (c.hero?.photo_id || ""))}">
            <img src="${escXml(c.tip?.photo_url || c.hero?.photo_url)}" alt="${escXml(c.tip?.title_he || c.hero?.title_he || "")}" class="nl-tip-img" loading="lazy">
          </a>` : ""}
        </div>
      </div>
    </section>` : "";
  const linksSection = isFull && c.links ? `
    <section class="nl-section nl-links-section">
      <div class="nl-section-badge" data-he="\u05E7\u05D9\u05E9\u05D5\u05E8\u05D9\u05DD \u05E9\u05D9\u05DE\u05D5\u05E9\u05D9\u05D9\u05DD" data-en="Useful Links">\u05E7\u05D9\u05E9\u05D5\u05E8\u05D9\u05DD \u05E9\u05D9\u05DE\u05D5\u05E9\u05D9\u05D9\u05DD</div>
      <div class="nl-links-row">${c.links.map(
    (l) => `<a class="nl-link-pill" href="${escXml(l.url)}" data-he="${escXml(l.label_he)}" data-en="${escXml(l.label_en)}">${escXml(l.label_he)}</a>`
  ).join("")}</div>
    </section>` : "";
  const newPhotosSection = c.new_photos && c.new_photos.length ? `
    <section class="nl-section nl-new-photos-section">
      <div class="nl-section-badge" data-he="\u05D7\u05D3\u05E9 \u05D1\u05D2\u05DC\u05E8\u05D9\u05D4" data-en="New in Gallery">\u05D7\u05D3\u05E9 \u05D1\u05D2\u05DC\u05E8\u05D9\u05D4</div>
      <div class="nl-new-photos-grid">
        ${c.new_photos.map((p) => `
          <a class="nl-new-photo-card" href="/?photo=${escXml(p.id)}">
            <div class="nl-new-photo-img-wrap">
              <img src="${escXml(p.url)}" alt="${escXml(p.title)}" loading="lazy">
              <span class="nl-new-badge" data-he="\u05D7\u05D3\u05E9" data-en="New">\u05D7\u05D3\u05E9</span>
            </div>
            <span class="nl-new-photo-title">${escXml(p.title)}</span>
          </a>`).join("")}
      </div>
      <a class="nl-new-gallery-link" href="/" data-he="\u05DC\u05DB\u05DC \u05D4\u05D2\u05DC\u05E8\u05D9\u05D4 \u2190" data-en="Full Gallery \u2192">\u05DC\u05DB\u05DC \u05D4\u05D2\u05DC\u05E8\u05D9\u05D4 \u2190</a>
    </section>` : "";
  const galleryBadgeHe = c.hero?.category ? `\u05E2\u05D5\u05D3 ${escXml(c.hero.category)}` : "\u05E2\u05D5\u05D3 \u05DE\u05D4\u05D2\u05DC\u05E8\u05D9\u05D4";
  const galleryBadgeEn = c.hero?.category ? `More ${escXml(c.hero.category)}` : "More from Gallery";
  const galleryStripSection = c.gallery_photos && c.gallery_photos.length ? `
    <section class="nl-section nl-gallery-section">
      <div class="nl-section-badge" data-he="${galleryBadgeHe}" data-en="${galleryBadgeEn}">${galleryBadgeHe}</div>
      <div class="nl-gallery-strip">
        ${c.gallery_photos.slice(0, 3).map(
    (photo) => `<a class="nl-gallery-thumb" href="/?photo=${escXml(photo.id)}">
            <img src="${escXml(photo.url)}" alt="${escXml(photo.title)}" loading="lazy">
            <span>${escXml(photo.title)}</span>
          </a>`
  ).join("")}
        <a class="nl-gallery-more" href="/" data-he="\u05DC\u05DB\u05DC \u05D4\u05D2\u05DC\u05E8\u05D9\u05D4 \u2190" data-en="Full Gallery \u2192">\u05DC\u05DB\u05DC \u05D4\u05D2\u05DC\u05E8\u05D9\u05D4 \u2190</a>
      </div>
    </section>` : "";
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
        <a class="nl-btn-primary" href="/">\u05DC\u05DB\u05DC \u05D4\u05DE\u05D1\u05E6\u05E2\u05D9\u05DD \u2190</a>
      </div>
    </section>` : "";
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
  const _heroPhotoHref = c.hero?.photo_id ? `/?photo=${escXml(c.hero.photo_id)}` : "/";
  const _heroCat = c.hero?.category || "";
  const _ctaByCategory = {
    "\u05E4\u05D5\u05E8\u05D8\u05E8\u05D8": [
      { ico: _icoUser, label: "\u05E8\u05DB\u05D5\u05E9 \u05E7\u05D5\u05D1\u05E5 \u05E4\u05D5\u05E8\u05D8\u05E8\u05D8", href: _heroPhotoHref },
      { ico: _icoGift, label: "\u05DE\u05EA\u05E0\u05D4 \u05DE\u05E8\u05D2\u05E9\u05EA", href: "/contact/" },
      { ico: _icoCamera, label: "\u05E1\u05E9\u05DF \u05E6\u05D9\u05DC\u05D5\u05DD \u05D0\u05D9\u05E9\u05D9", href: "/contact/" },
      { ico: _icoImage, label: "\u05DB\u05DC \u05D4\u05D2\u05DC\u05E8\u05D9\u05D4", href: "/" }
    ],
    "\u05E2\u05D9\u05E8\u05D5\u05E0\u05D9": [
      { ico: _icoHome, label: "\u05E7\u05D5\u05D1\u05E5 \u05DC\u05E1\u05DC\u05D5\u05DF / \u05DE\u05E9\u05E8\u05D3", href: _heroPhotoHref },
      { ico: _icoBrief, label: "\u05E2\u05D9\u05E6\u05D5\u05D1 \u05D5\u05D0\u05D3\u05E8\u05D9\u05DB\u05DC\u05D5\u05EA", href: "/?category=%D7%A2%D7%99%D7%A8%D7%95%D7%A0%D7%99" },
      { ico: _icoGift, label: "\u05DE\u05EA\u05E0\u05D4 \u05D9\u05D9\u05D7\u05D5\u05D3\u05D9\u05EA", href: "/contact/" },
      { ico: _icoImage, label: "\u05DB\u05DC \u05D4\u05D2\u05DC\u05E8\u05D9\u05D4", href: "/" }
    ],
    "\u05D0\u05D9\u05E8\u05D5\u05E2\u05D9\u05DD": [
      { ico: _icoCamera, label: "\u05E6\u05DC\u05DD \u05DC\u05D0\u05D9\u05E8\u05D5\u05E2 \u05E9\u05DC\u05DA", href: "/contact/" },
      { ico: _icoBrief, label: "\u05D7\u05EA\u05D5\u05E0\u05D4 / \u05DB\u05E0\u05E1 / \u05EA\u05D0\u05D2\u05D9\u05D3", href: "/contact/" },
      { ico: _icoGift, label: "\u05DE\u05EA\u05E0\u05D4 \u05E2\u05E1\u05E7\u05D9\u05EA", href: "/contact/" },
      { ico: _icoHome, label: "\u05E7\u05D5\u05D1\u05E5 \u05DC\u05E1\u05DC\u05D5\u05DF", href: _heroPhotoHref }
    ]
  };
  const contactOutreachSection = `
    <section class="nl-section nl-contact-section">
      <div class="nl-contact-card">
        <h2 class="nl-contact-heading" data-he="\u05DE\u05D7\u05E4\u05E9 \u05EA\u05DE\u05D5\u05E0\u05D4 \u05DC\u05D1\u05D9\u05EA \u05D5\u05DC\u05DE\u05E9\u05E8\u05D3?" data-en="Looking for a photo for home or office?">\u05DE\u05D7\u05E4\u05E9 \u05EA\u05DE\u05D5\u05E0\u05D4 \u05DC\u05D1\u05D9\u05EA \u05D5\u05DC\u05DE\u05E9\u05E8\u05D3?</h2>
        <div class="nl-contact-header">
          <span class="nl-contact-avatar">${_svgPerson}</span>
          <div class="nl-contact-name" data-he="\u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6" data-en="Amit Erez">\u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6</div>
        </div>
        <div class="nl-contact-btns">
          <a class="nl-contact-btn nl-contact-wa" href="https://wa.me/972503333227" target="_blank" rel="noopener">${_svgWa} <span data-he="\u05D5\u05D5\u05D0\u05D8\u05E1\u05D0\u05E4" data-en="WhatsApp">\u05D5\u05D5\u05D0\u05D8\u05E1\u05D0\u05E4</span></a>
          <a class="nl-contact-btn" href="tel:+972503333227">${_svgPhone} 050-3333227</a>
        </div>
        <p class="nl-contact-quote" data-he="\u05E8\u05D5\u05E6\u05D4 \u05DC\u05D1\u05D7\u05D5\u05E8 \u05EA\u05DE\u05D5\u05E0\u05D4 \u05DC\u05D1\u05D9\u05EA? \u05DC\u05E7\u05E0\u05D5\u05EA \u05E7\u05D5\u05D1\u05E5, \u05D0\u05D5 \u05E1\u05EA\u05DD \u05DC\u05E9\u05D0\u05D5\u05DC? \u05D0\u05E0\u05D9 \u05DB\u05D0\u05DF." data-en="Want to choose a photo for your home? Buy a file, or just ask? I'm here.">\u05E8\u05D5\u05E6\u05D4 \u05DC\u05D1\u05D7\u05D5\u05E8 \u05EA\u05DE\u05D5\u05E0\u05D4 \u05DC\u05D1\u05D9\u05EA? \u05DC\u05E7\u05E0\u05D5\u05EA \u05E7\u05D5\u05D1\u05E5, \u05D0\u05D5 \u05E1\u05EA\u05DD \u05DC\u05E9\u05D0\u05D5\u05DC? \u05D0\u05E0\u05D9 \u05DB\u05D0\u05DF.</p>
        <p class="nl-contact-note" data-he="\u05E0\u05D9\u05EA\u05DF \u05DC\u05E9\u05DC\u05DD: \u05D1\u05D9\u05D8 \xB7 \u05E4\u05D9\u05D9\u05D1\u05D5\u05E7\u05E1 \xB7 \u05E4\u05D9\u05D9\u05E4\u05DC" data-en="Payment: Bit \xB7 Paybox \xB7 PayPal">\u05E0\u05D9\u05EA\u05DF \u05DC\u05E9\u05DC\u05DD: \u05D1\u05D9\u05D8 \xB7 \u05E4\u05D9\u05D9\u05D1\u05D5\u05E7\u05E1 \xB7 \u05E4\u05D9\u05D9\u05E4\u05DC</p>
      </div>
    </section>`;
  const previewBanner = isPreview ? `<div style="background:#7c3f00;color:#fff;text-align:center;padding:.5rem;font-size:.8rem">\u05D8\u05D9\u05D5\u05D8\u05D4 \u2014 \u05DC\u05D0 \u05E4\u05D5\u05E8\u05E1\u05DE\u05D4</div>` : "";
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escXml(issue.title_he)} | Amit Photos</title>
${!isPreview ? `<link rel="canonical" href="https://amitphotos.com/newsletter/${escXml(slug)}/">` : ""}
${!isPreview ? GA_SNIPPET : ""}
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
<script src="/assets/js/nav.js" defer><\/script>
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
${newPhotosSection ? '<hr class="nl-divider">' : ""}
${galleryStripSection}
${saleBannerSection}
${galleryStripSection || saleBannerSection ? '<hr class="nl-divider">' : ""}
${guideSection}
${guideSection ? '<hr class="nl-divider">' : ""}
${locationSection}
${locationSection ? '<hr class="nl-divider">' : ""}
${tipSection}
${tipSection ? '<hr class="nl-divider">' : ""}
${linksSection}
${tipSection || linksSection ? '<hr class="nl-divider">' : ""}
${contactOutreachSection}
<footer class="nl-footer">
  <p>\xA9 Amit Photos | <a href="/">amitphotos.com</a></p>
</footer>
<div class="nl-actions no-print">
  <button onclick="window.print()">\u{1F5A8} <span data-he="\u05D4\u05D3\u05E4\u05E1 / \u05E9\u05DE\u05D5\u05E8 PDF" data-en="Print / Save PDF">\u05D4\u05D3\u05E4\u05E1 / \u05E9\u05DE\u05D5\u05E8 PDF</span></button>
  <a href="${waHref}" target="_blank" rel="noopener">\u{1F4F2} <span data-he="\u05E9\u05EA\u05E3 \u05D1-WhatsApp" data-en="Share on WhatsApp">\u05E9\u05EA\u05E3 \u05D1-WhatsApp</span></a>
  <button onclick="copyLink()">\u{1F517} <span id="copy-label" data-he="\u05D4\u05E2\u05EA\u05E7 \u05E7\u05D9\u05E9\u05D5\u05E8" data-en="Copy Link">\u05D4\u05E2\u05EA\u05E7 \u05E7\u05D9\u05E9\u05D5\u05E8</span></button>
</div>
<section class="nl-subscribe-section no-print">
  <div class="nl-subscribe-card">
    <h3 data-he="\u05E8\u05D5\u05E6\u05D4 \u05DC\u05E7\u05D1\u05DC \u05D0\u05EA \u05D4\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8?" data-en="Want to receive the newsletter?">\u05E8\u05D5\u05E6\u05D4 \u05DC\u05E7\u05D1\u05DC \u05D0\u05EA \u05D4\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8?</h3>
    <p data-he="\u05D2\u05D9\u05DC\u05D9\u05D5\u05E0\u05D5\u05EA \u05D7\u05D5\u05D3\u05E9\u05D9\u05D9\u05DD \u2014 \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA, \u05DE\u05D3\u05E8\u05D9\u05DB\u05D9\u05DD \u05D5\u05DE\u05E7\u05D5\u05DE\u05D5\u05EA \u05E6\u05D9\u05DC\u05D5\u05DD \u05D9\u05E9\u05D9\u05E8\u05D5\u05EA \u05DC\u05DE\u05D9\u05D9\u05DC." data-en="Monthly issues \u2014 photos, guides and shooting locations delivered to your inbox.">\u05D2\u05D9\u05DC\u05D9\u05D5\u05E0\u05D5\u05EA \u05D7\u05D5\u05D3\u05E9\u05D9\u05D9\u05DD \u2014 \u05EA\u05DE\u05D5\u05E0\u05D5\u05EA, \u05DE\u05D3\u05E8\u05D9\u05DB\u05D9\u05DD \u05D5\u05DE\u05E7\u05D5\u05DE\u05D5\u05EA \u05E6\u05D9\u05DC\u05D5\u05DD \u05D9\u05E9\u05D9\u05E8\u05D5\u05EA \u05DC\u05DE\u05D9\u05D9\u05DC.</p>
    <form class="nl-sub-form" onsubmit="nlSubscribe(event)">
      <input type="email" id="nl-email" placeholder="\u05DB\u05EA\u05D5\u05D1\u05EA \u05D4\u05DE\u05D9\u05D9\u05DC \u05E9\u05DC\u05DA" required>
      <button type="submit" data-he="\u05D4\u05E8\u05E9\u05DE\u05D4" data-en="Subscribe">\u05D4\u05E8\u05E9\u05DE\u05D4</button>
    </form>
    <p id="nl-sub-msg"></p>
    <div id="nl-unsub-wrap" style="margin-top:.6rem">
      <button class="nl-unsub-link" onclick="nlShowUnsub()" data-he="\u05D4\u05E1\u05E8 \u05D0\u05D5\u05EA\u05D9 \u05DE\u05D4\u05E8\u05E9\u05D9\u05DE\u05D4" data-en="Unsubscribe">\u05D4\u05E1\u05E8 \u05D0\u05D5\u05EA\u05D9 \u05DE\u05D4\u05E8\u05E9\u05D9\u05DE\u05D4</button>
    </div>
    <div id="nl-unsub-form" style="display:none;margin-top:.5rem">
      <form class="nl-sub-form" onsubmit="nlUnsubscribe(event)">
        <input type="email" id="nl-unsub-email" placeholder="\u05DB\u05EA\u05D5\u05D1\u05EA \u05D4\u05DE\u05D9\u05D9\u05DC \u05E9\u05DC\u05DA" required>
        <button type="submit" style="background:#444;color:#fff" data-he="\u05D4\u05E1\u05E8" data-en="Remove">\u05D4\u05E1\u05E8</button>
      </form>
      <p id="nl-unsub-msg"></p>
    </div>
  </div>
</section>
<script>
function getLang(){return localStorage.getItem('lang')||'he'}
function applyLang(forceLang){if(window.__langChanging)return;window.__langChanging=true;const lang=forceLang||getLang();if(forceLang)localStorage.setItem('lang',forceLang);const isEn=lang==='en';document.documentElement.dir=isEn?'ltr':'rtl';document.documentElement.lang=lang;document.body.style.direction=isEn?'ltr':'rtl';document.querySelectorAll('[data-he]').forEach(el=>{el.innerHTML=isEn?(el.dataset.en||el.dataset.he):el.dataset.he});const btn=document.getElementById('nl-lang-btn');if(btn)btn.textContent=isEn?'HE':'EN';if(typeof window.applyNavLang==='function')window.applyNavLang(lang);window.__langChanging=false}
function toggleLang(){applyLang(getLang()==='he'?'en':'he')}
applyLang();window.setLang=applyLang;window.addEventListener('storage',e=>{if(e.key==='lang')applyLang()})
function showStep(n){document.querySelectorAll('.nl-step-content').forEach((el,i)=>{el.style.display=(i+1===n)?'':'none'});document.querySelectorAll('.nl-step-pill').forEach((el,i)=>{el.classList.toggle('nl-step-active',i+1===n)})}
function copyLink(){navigator.clipboard.writeText(location.href).then(()=>{const el=document.getElementById('copy-label');const orig=el.innerHTML;el.textContent='\u2713 \u05D4\u05D5\u05E2\u05EA\u05E7!';setTimeout(()=>{el.innerHTML=orig;applyLang()},2000)}).catch(()=>{})}
async function nlSubscribe(e){e.preventDefault();const email=document.getElementById('nl-email').value.trim();const msg=document.getElementById('nl-sub-msg');const btn=e.target.querySelector('button[type="submit"]');btn.disabled=true;try{const r=await fetch('/api/subscribers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});const d=await r.json();if(d.already){msg.style.color='#c8a96e';msg.textContent='\u05DB\u05D1\u05E8 \u05E8\u05E9\u05D5\u05DD/\u05D4 \u2014 \u05EA\u05E7\u05D1\u05DC \u05D0\u05EA \u05D4\u05D2\u05D9\u05DC\u05D9\u05D5\u05DF \u05D4\u05D1\u05D0!'}else if(d.ok){msg.style.color='#4caf50';msg.textContent='\u05E0\u05E8\u05E9\u05DE\u05EA! \u05EA\u05E7\u05D1\u05DC \u05D0\u05EA \u05D4\u05D2\u05D9\u05DC\u05D9\u05D5\u05DF \u05D4\u05D1\u05D0 \u05D9\u05E9\u05D9\u05E8\u05D5\u05EA \u05DC\u05DE\u05D9\u05D9\u05DC \u{1F389}';document.getElementById('nl-email').value=''}else{msg.style.color='#f44336';msg.textContent=d.error||'\u05E9\u05D2\u05D9\u05D0\u05D4'}}catch{msg.style.color='#f44336';msg.textContent='\u05E9\u05D2\u05D9\u05D0\u05EA \u05E8\u05E9\u05EA'}btn.disabled=false}
function nlShowUnsub(){document.getElementById('nl-unsub-form').style.display='';document.getElementById('nl-unsub-wrap').style.display='none'}
async function nlUnsubscribe(e){e.preventDefault();const email=document.getElementById('nl-unsub-email').value.trim();const msg=document.getElementById('nl-unsub-msg');const btn=e.target.querySelector('button[type="submit"]');btn.disabled=true;try{const r=await fetch('/api/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});const d=await r.json();if(d.ok&&d.notFound){msg.style.color='#c8a96e';msg.textContent='\u05DB\u05EA\u05D5\u05D1\u05EA \u05D6\u05D5 \u05D0\u05D9\u05E0\u05D4 \u05D1\u05E8\u05E9\u05D9\u05DE\u05D4'}else if(d.ok){msg.style.color='#4caf50';msg.textContent='\u05D4\u05D5\u05E1\u05E8\u05EA \u05DE\u05D4\u05E8\u05E9\u05D9\u05DE\u05D4 \u05D1\u05D4\u05E6\u05DC\u05D7\u05D4'}else{msg.style.color='#f44336';msg.textContent=d.error||'\u05E9\u05D2\u05D9\u05D0\u05D4'}}catch{msg.style.color='#f44336';msg.textContent='\u05E9\u05D2\u05D9\u05D0\u05EA \u05E8\u05E9\u05EA'}btn.disabled=false}
<\/script>
</body></html>`;
  return htmlRes(html, 200, "no-cache");
}
__name(handleNlIssue, "handleNlIssue");
async function handleAdminNlList(request, env) {
  if (!await checkAuth(request, env)) return new Response("Unauthorized", { status: 401 });
  const { results } = await env.DB.prepare(
    `SELECT id, slug, type, issue_number, title_he, status, published_at, created_at
     FROM newsletter_issues ORDER BY created_at DESC LIMIT 50`
  ).all();
  const rows = (results || []).map((issue) => {
    const statusBadge = issue.status === "published" ? `<span style="color:#4caf50">\u05E4\u05D5\u05E8\u05E1\u05DD</span>` : `<span style="color:#ff9800">\u05D8\u05D9\u05D5\u05D8\u05D4</span>`;
    const date = issue.created_at ? issue.created_at.slice(0, 10) : "";
    const previewUrl = `/admin/newsletter/${escXml(issue.id)}/preview/`;
    return `<tr>
      <td>${escXml(String(issue.issue_number))}</td>
      <td>${statusBadge}</td>
      <td>${escXml(issue.type === "full" ? "\u05DE\u05DC\u05D0" : "\u05D4\u05D1\u05D6\u05E7")}</td>
      <td>${escXml(issue.title_he)}</td>
      <td>${escXml(date)}</td>
      <td>
        <a href="/admin/newsletter/${escXml(issue.id)}/">\u05E2\u05E8\u05D5\u05DA</a> |
        <a href="${previewUrl}" target="_blank">\u05EA\u05E6\u05D5\u05D2\u05D4 \u05DE\u05E7\u05D3\u05D9\u05DE\u05D4</a> |
        <a href="#" onclick="showTestModal('${escXml(issue.id)}','${escXml(issue.slug)}');return false">\u05E9\u05DC\u05D7 \u05DC\u05D1\u05D3\u05D9\u05E7\u05D4</a> |
        <a href="#" onclick="deleteAndRecreate('${escXml(issue.id)}','${escXml(issue.type)}');return false" style="color:#f44336">\u05DE\u05D7\u05E7 \u05D5\u05D9\u05E6\u05D5\u05E8 \u05DE\u05D7\u05D3\u05E9</a>
        ${issue.status === "published" ? ` | <a href="/newsletter/${escXml(issue.slug)}/" target="_blank">\u05E6\u05E4\u05D4</a>` : ""}
      </td>
    </tr>`;
  }).join("");
  return htmlRes(`<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>\u05E0\u05D9\u05D4\u05D5\u05DC \u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8 | Admin</title>
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
<h1>\u05E0\u05D9\u05D4\u05D5\u05DC \u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8</h1>
<div class="actions">
  <a href="/admin/"><button type="button" class="btn-back">\u2190 \u05D7\u05D6\u05E8\u05D4 \u05DC\u05D0\u05D3\u05DE\u05D9\u05DF</button></a>
  <button onclick="generate('full')">\u{1F4F0} \u05E6\u05D5\u05E8 \u05D2\u05D9\u05DC\u05D9\u05D5\u05DF \u05DE\u05DC\u05D0</button>
  <button onclick="generate('flash')">\u26A1 \u05E6\u05D5\u05E8 \u05D4\u05D1\u05D6\u05E7</button>
</div>
<div id="msg"></div>

<div class="sub-card">
  <div class="sub-header" onclick="toggleSubs()">
    <span>\u{1F465} \u05DE\u05E0\u05D5\u05D9\u05D9\u05DD: <span id="sub-count">...</span></span>
    <span id="sub-toggle-icon">\u25BC</span>
  </div>
  <div id="sub-body" style="display:none">
    <div style="padding:0 .5rem .5rem">
    <table class="sub-table">
      <thead><tr><th>\u05E9\u05DD</th><th>\u05D0\u05D9\u05DE\u05D9\u05D9\u05DC</th><th>\u05EA\u05D0\u05E8\u05D9\u05DA</th><th></th></tr></thead>
      <tbody id="sub-rows"><tr><td colspan="4" style="text-align:center;color:#888;padding:1rem">\u05D8\u05D5\u05E2\u05DF...</td></tr></tbody>
    </table>
    </div>
  </div>
</div>

<table>
  <thead><tr><th>#</th><th>\u05E1\u05D8\u05D8\u05D5\u05E1</th><th>\u05E1\u05D5\u05D2</th><th>\u05DB\u05D5\u05EA\u05E8\u05EA</th><th>\u05EA\u05D0\u05E8\u05D9\u05DA</th><th>\u05E4\u05E2\u05D5\u05DC\u05D5\u05EA</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#888;padding:2rem">\u05D0\u05D9\u05DF \u05D2\u05D9\u05DC\u05D9\u05D5\u05E0\u05D5\u05EA \u05E2\u05D3\u05D9\u05D9\u05DF</td></tr>'}</tbody>
</table>

<div class="modal-overlay" id="test-modal">
  <div class="modal">
    <h2>\u05E9\u05DC\u05D7 \u05DC\u05D1\u05D3\u05D9\u05E7\u05D4</h2>
    <label>\u05E9\u05DC\u05D7 \u05DC\u05DE\u05D9\u05D9\u05DC</label>
    <input type="email" id="test-email" placeholder="email@example.com">
    <div class="modal-actions">
      <button onclick="sendTestEmail()">\u{1F4E7} \u05E9\u05DC\u05D7 \u05DE\u05D9\u05D9\u05DC</button>
      <button class="btn-wa" onclick="shareWhatsApp()">\u{1F4AC} \u05E9\u05EA\u05E3 \u05D1\u05D5\u05D5\u05D8\u05E1\u05D0\u05E4</button>
      <button class="btn-cancel" onclick="closeTestModal()">\u05D1\u05D9\u05D8\u05D5\u05DC</button>
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
  if (!email) { msgEl.style.color='#f44336'; msgEl.textContent='\u05D4\u05DB\u05E0\u05E1 \u05DB\u05EA\u05D5\u05D1\u05EA \u05DE\u05D9\u05D9\u05DC'; return; }
  msgEl.style.color='#888'; msgEl.textContent='\u05E9\u05D5\u05DC\u05D7...';
  const tok = localStorage.getItem('session_token') || sessionStorage.getItem('session_token') || '';
  try {
    const r = await fetch('/api/admin/newsletter/' + _testId + '/send-test', {
      method: 'POST',
      headers: {'Content-Type':'application/json','X-Session-Token':tok},
      body: JSON.stringify({ email })
    });
    const d = await r.json();
    if (d.ok) { msgEl.style.color='#4caf50'; msgEl.textContent='\u2713 \u05E0\u05E9\u05DC\u05D7! \u05D1\u05D3\u05D5\u05E7 \u05D0\u05EA \u05EA\u05D9\u05D1\u05EA \u05D4\u05D3\u05D5\u05D0\u05E8.'; }
    else { msgEl.style.color='#f44336'; msgEl.textContent='\u2717 ' + (d.error || '\u05E9\u05D2\u05D9\u05D0\u05D4'); }
  } catch(e) { msgEl.style.color='#f44336'; msgEl.textContent='\u2717 \u05E9\u05D2\u05D9\u05D0\u05EA \u05E8\u05E9\u05EA'; }
}

function shareWhatsApp() {
  const previewUrl = 'https://amitphotos.com/admin/newsletter/' + _testId + '/preview/';
  const text = encodeURIComponent('\u05EA\u05D5\u05DB\u05DC \u05DC\u05D4\u05E1\u05EA\u05DB\u05DC \u05E2\u05DC \u05D4\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8 \u05DC\u05E4\u05E0\u05D9 \u05E4\u05E8\u05E1\u05D5\u05DD? ' + previewUrl);
  window.open('https://wa.me/?text=' + text, '_blank');
}

async function generate(type) {
  const msg = document.getElementById('msg');
  const btns = document.querySelectorAll('button');
  btns.forEach(b => b.disabled = true);
  msg.style.cssText = 'display:block;background:#1a2a1a;color:#c8a96e;border:1px solid #c8a96e33;padding:.75rem 1rem;border-radius:8px;font-size:.95rem;margin-bottom:1rem';
  msg.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite;margin-left:.4rem">\u23F3</span> \u05D9\u05D5\u05E6\u05E8 \u05D8\u05D9\u05D5\u05D8\u05D4 \u05E2\u05DD Claude... (\u05E2\u05D3 30 \u05E9\u05E0\u05D9\u05D5\u05EA)';
  const tok = localStorage.getItem('session_token') || sessionStorage.getItem('session_token') || '';
  try {
    const r = await fetch('/api/admin/newsletter/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': tok },
      body: JSON.stringify({ type })
    });
    const d = await r.json();
    if (d.skipped) {
      msg.style.cssText = 'display:block;background:#2a1a00;color:#ff9800;border:1px solid #ff980033;padding:.75rem 1rem;border-radius:8px;font-size:.95rem;margin-bottom:1rem';
      msg.textContent = '\u05D2\u05D9\u05DC\u05D9\u05D5\u05DF \u05DC\u05EA\u05E7\u05D5\u05E4\u05D4 \u05D6\u05D5 \u05DB\u05D1\u05E8 \u05E7\u05D9\u05D9\u05DD';
      btns.forEach(b => b.disabled = false);
    } else if (d.slug) {
      msg.style.cssText = 'display:block;background:#0a2a0a;color:#4caf50;border:1px solid #4caf5033;padding:.75rem 1rem;border-radius:8px;font-size:.95rem;margin-bottom:1rem';
      msg.textContent = '\u2713 \u05E0\u05D5\u05E6\u05E8 \u05D1\u05D4\u05E6\u05DC\u05D7\u05D4! \u05DE\u05E2\u05D1\u05D9\u05E8 \u05DC\u05E2\u05E8\u05D9\u05DB\u05D4...';
      setTimeout(() => location.href = '/admin/newsletter/' + d.id + '/', 800);
    } else {
      msg.style.cssText = 'display:block;background:#2a0a0a;color:#f44336;border:1px solid #f4433633;padding:.75rem 1rem;border-radius:8px;font-size:.95rem;margin-bottom:1rem';
      msg.textContent = '\u2717 ' + (d.error || '\u05E9\u05D2\u05D9\u05D0\u05D4');
      btns.forEach(b => b.disabled = false);
    }
  } catch(e) {
    msg.style.cssText = 'display:block;background:#2a0a0a;color:#f44336;border:1px solid #f4433633;padding:.75rem 1rem;border-radius:8px;font-size:.95rem;margin-bottom:1rem';
    msg.textContent = '\u2717 \u05E9\u05D2\u05D9\u05D0\u05EA \u05E8\u05E9\u05EA: ' + e.message;
    btns.forEach(b => b.disabled = false);
  }
}

async function deleteAndRecreate(id, type) {
  if (!confirm('\u05D1\u05D8\u05D5\u05D7? \u05D4\u05D2\u05D9\u05DC\u05D9\u05D5\u05DF \u05D9\u05D9\u05DE\u05D7\u05E7 \u05D5\u05D9\u05D9\u05D5\u05D5\u05E6\u05E8 \u05D2\u05D9\u05DC\u05D9\u05D5\u05DF \u05D7\u05D3\u05E9 \u05DE\u05D0\u05E4\u05E1.')) return;
  const msg = document.getElementById('msg');
  const btns = document.querySelectorAll('button');
  btns.forEach(b => b.disabled = true);
  msg.style.cssText = 'display:block;background:#1a0a0a;color:#f44336;border:1px solid #f4433633;padding:.75rem 1rem;border-radius:8px;font-size:.95rem;margin-bottom:1rem';
  msg.textContent = '\u05DE\u05D5\u05D7\u05E7...';
  const tok = localStorage.getItem('session_token') || sessionStorage.getItem('session_token') || '';
  try {
    const r = await fetch('/api/admin/newsletter/' + id, {
      method: 'DELETE',
      headers: {'X-Session-Token': tok}
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      msg.textContent = '\u2717 ' + (d.error || '\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05DE\u05D7\u05D9\u05E7\u05D4');
      btns.forEach(b => b.disabled = false);
      return;
    }
    await generate(type);
  } catch(e) {
    msg.textContent = '\u2717 \u05E9\u05D2\u05D9\u05D0\u05EA \u05E8\u05E9\u05EA: ' + e.message;
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
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;padding:1rem">\u05D0\u05D9\u05DF \u05DE\u05E0\u05D5\u05D9\u05D9\u05DD \u05E2\u05D3\u05D9\u05D9\u05DF</td></tr>';
    return;
  }
  tbody.innerHTML = _subs.map(function(s) {
    return '<tr><td>' + _escH(s.name) + '</td><td><a href="mailto:' + _escH(s.email) + '">' + _escH(s.email) + '</a></td><td>' + (s.created_at ? s.created_at.slice(0,10) : '') + '</td><td><button class="btn-del" onclick="deleteSub(\\'' + _escH(s.id) + '\\')">\u2715</button></td></tr>';
  }).join('');
}

async function deleteSub(id) {
  if (!confirm('\u05DC\u05DE\u05D7\u05D5\u05E7 \u05DE\u05E0\u05D5\u05D9 \u05D6\u05D4?')) return;
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
  icon.textContent = open ? '\u25BC' : '\u25B2';
  if (!open && !_subsLoaded) loadSubsFull();
}

async function loadSubsFull() {
  if (_subsLoaded) { renderSubRows(); return; }
  var r = await fetch('/api/subscribers', { headers:{'X-Session-Token':_nlTok()} });
  if (!r.ok) { document.getElementById('sub-rows').innerHTML = '<tr><td colspan="4" style="color:#f44336;padding:1rem">\u05E9\u05D2\u05D9\u05D0\u05EA \u05D0\u05D9\u05DE\u05D5\u05EA</td></tr>'; return; }
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
<\/script>
<style>@keyframes spin{to{transform:rotate(360deg)}}</style>
</body></html>`);
}
__name(handleAdminNlList, "handleAdminNlList");
async function handleAdminNlEditor(request, env, id) {
  if (!await checkAuth(request, env)) return new Response("Unauthorized", { status: 401 });
  const issue = await env.DB.prepare("SELECT * FROM newsletter_issues WHERE id=?").bind(id).first();
  if (!issue) return new Response("Not found", { status: 404 });
  const c = JSON.parse(issue.content_json || "{}");
  const field = /* @__PURE__ */ __name((label, key, subkey, val) => `<div class="field">
      <label>${escXml(label)}</label>
      <textarea name="${escXml(key + "." + subkey)}" rows="3">${escXml(val || "")}</textarea>
    </div>`, "field");
  const heroFields = c.hero ? `
    <h2 style="display:flex;justify-content:space-between;align-items:center"><span>\u05EA\u05DE\u05D5\u05E0\u05D4 \u05E8\u05D0\u05E9\u05D9\u05EA</span><button type="button" class="btn-secondary" onclick="swapPhoto()" style="font-size:.75rem;padding:.3rem .7rem">\u{1F504} \u05D4\u05D7\u05DC\u05E3 \u05EA\u05DE\u05D5\u05E0\u05D4</button></h2>
    <div class="field"><label>Photo ID</label><input name="hero.photo_id" value="${escXml(c.hero.photo_id || "")}"></div>
    ${field("\u05D8\u05E7\u05E1\u05D8 \u05E2\u05D1\u05E8\u05D9\u05EA", "hero", "text_he", c.hero.text_he)}
    ${field("\u05D8\u05E7\u05E1\u05D8 \u05D0\u05E0\u05D2\u05DC\u05D9\u05EA", "hero", "text_en", c.hero.text_en)}` : "";
  const guideFields = c.guide ? `
    <h2>\u05DE\u05D3\u05E8\u05D9\u05DA \u05D4\u05D7\u05D5\u05D3\u05E9</h2>
    <div class="field"><label>Slug</label><input name="guide.slug" value="${escXml(c.guide.slug || "")}"></div>
    ${field("\u05D8\u05E7\u05E1\u05D8 \u05E2\u05D1\u05E8\u05D9\u05EA", "guide", "text_he", c.guide.text_he)}
    ${field("\u05D8\u05E7\u05E1\u05D8 \u05D0\u05E0\u05D2\u05DC\u05D9\u05EA", "guide", "text_en", c.guide.text_en)}` : "";
  const locationFields = c.location ? `
    <h2>\u05DE\u05E7\u05D5\u05DD \u05DC\u05E6\u05D9\u05DC\u05D5\u05DD</h2>
    ${field("\u05D8\u05E7\u05E1\u05D8 \u05E2\u05D1\u05E8\u05D9\u05EA", "location", "text_he", c.location.text_he)}
    ${field("\u05D8\u05E7\u05E1\u05D8 \u05D0\u05E0\u05D2\u05DC\u05D9\u05EA", "location", "text_en", c.location.text_en)}` : "";
  const tipFields = c.tip ? `
    <h2 style="display:flex;justify-content:space-between;align-items:center"><span>\u05D8\u05D9\u05E4 \u05D4\u05D7\u05D5\u05D3\u05E9</span><button type="button" class="btn-secondary" onclick="regenTip()" style="font-size:.75rem;padding:.3rem .7rem">\u{1F3B2} \u05D8\u05D9\u05E4 \u05D0\u05D7\u05E8</button></h2>
    ${field("\u05DB\u05D5\u05EA\u05E8\u05EA \u05E2\u05D1\u05E8\u05D9\u05EA", "tip", "title_he", c.tip.title_he)}
    ${field("\u05D8\u05E7\u05E1\u05D8 \u05E2\u05D1\u05E8\u05D9\u05EA", "tip", "text_he", c.tip.text_he)}
    ${field("\u05D8\u05E7\u05E1\u05D8 \u05D0\u05E0\u05D2\u05DC\u05D9\u05EA", "tip", "text_en", c.tip.text_en)}` : "";
  const saleFields = issue.type === "full" ? `
  <h2>\u05DE\u05D1\u05E6\u05E2 \u05D4\u05D7\u05D5\u05D3\u05E9</h2>
  <p style="font-size:.8rem;color:#888;margin-bottom:.75rem">\u05D4\u05DE\u05D1\u05E6\u05E2 \u05D0\u05D9\u05E0\u05D5 \u05E0\u05D5\u05E6\u05E8 \u05D0\u05D5\u05D8\u05D5\u05DE\u05D8\u05D9\u05EA \u2014 \u05DE\u05DC\u05D0 \u05D9\u05D3\u05E0\u05D9\u05EA \u05DB\u05D0\u05E9\u05E8 \u05D9\u05E9 \u05DE\u05D1\u05E6\u05E2 \u05D0\u05DE\u05D9\u05EA\u05D9 \u05DC\u05D4\u05E6\u05D9\u05E2.</p>
  ${field("\u05DB\u05D5\u05EA\u05E8\u05EA \u05D4\u05DE\u05D1\u05E6\u05E2 (\u05E2\u05D1\u05E8\u05D9\u05EA)", "sale", "title_he", c.sale?.title_he)}
  ${field("\u05EA\u05D9\u05D0\u05D5\u05E8 (\u05E2\u05D1\u05E8\u05D9\u05EA, \u05E2\u05D3 10 \u05DE\u05D9\u05DC\u05D9\u05DD)", "sale", "desc_he", c.sale?.desc_he)}
  ${field("\u05DE\u05D7\u05D9\u05E8 \u05DE\u05E7\u05D5\u05E8\u05D9", "sale", "original_price", c.sale?.original_price)}
  ${field("\u05DE\u05D7\u05D9\u05E8 \u05DE\u05D1\u05E6\u05E2", "sale", "sale_price", c.sale?.sale_price)}
  ${field("\u05EA\u05D5\u05D5\u05D9\u05EA \u05D4\u05E0\u05D7\u05D4", "sale", "discount_label", c.sale?.discount_label)}` : "";
  const guideStepsFields = issue.type === "full" && c.guide ? `
  <h2>\u05E9\u05DC\u05D1\u05D9 \u05D4\u05DE\u05D3\u05E8\u05D9\u05DA</h2>
  ${[0, 1, 2].map((i) => {
    const step = c.guide?.steps?.[i] || {};
    return `<div class="field"><label>\u05E9\u05DC\u05D1 ${i + 1} \u2014 \u05DB\u05D5\u05EA\u05E8\u05EA</label>
      <input name="guide.steps.${i}.title_he" value="${escXml(step.title_he || "")}"></div>
    <div class="field"><label>\u05E9\u05DC\u05D1 ${i + 1} \u2014 \u05D8\u05E7\u05E1\u05D8</label>
      <textarea name="guide.steps.${i}.text_he" rows="3">${escXml(step.text_he || "")}</textarea></div>`;
  }).join("")}` : "";
  const publishBtn = issue.status === "draft" ? `<button type="button" onclick="publish()">\u{1F680} \u05E4\u05E8\u05E1\u05DD</button>` : `<span style="color:#4caf50">\u2713 \u05E4\u05D5\u05E8\u05E1\u05DD \u05D1-${escXml((issue.published_at || "").slice(0, 10))}</span>`;
  const issuePublicUrl = `https://amitphotos.com/newsletter/${escXml(issue.slug)}/`;
  const fbShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent("https://amitphotos.com/newsletter/" + issue.slug + "/")}`;
  const sendSection = issue.status === "published" ? `
<div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid #222;display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
  <button type="button" id="send-btn" onclick="sendToSubs()">\u{1F4E7} \u05E9\u05DC\u05D7 \u05DC\u05E0\u05E8\u05E9\u05DE\u05D9\u05DD (<span id="sub-count">...</span>)</button>
  <a href="${fbShareUrl}" target="_blank" rel="noopener" style="background:#1877f2;color:#fff;border:none;padding:.5rem 1.1rem;border-radius:8px;cursor:pointer;font-size:.85rem;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;gap:.4rem">
    <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.026 1.791-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
    \u05E9\u05EA\u05E3 \u05D1\u05E4\u05D9\u05D9\u05E1\u05D1\u05D5\u05E7
  </a>
  <span id="send-msg" style="font-size:.85rem;display:none"></span>
</div>` : "";
  return htmlRes(`<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>\u05E2\u05D5\u05E8\u05DA \u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8 | Admin</title>
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
  <button onclick="save()">\u{1F4BE} \u05E9\u05DE\u05D5\u05E8 \u05D8\u05D9\u05D5\u05D8\u05D4</button>
  <a href="/admin/newsletter/${escXml(id)}/preview/" target="_blank"><button type="button" class="btn-secondary">\u{1F441} \u05EA\u05E6\u05D5\u05D2\u05D4 \u05DE\u05E7\u05D3\u05D9\u05DE\u05D4</button></a>
  ${publishBtn}
  <a href="/admin/newsletter/"><button type="button" class="btn-secondary">\u2190 \u05D7\u05D6\u05E8\u05D4 \u05DC\u05E8\u05E9\u05D9\u05DE\u05D4</button></a>
</div>
<div id="msg"></div>
${sendSection}
<div class="field" style="max-width:180px;margin-top:1rem"><label>\u05DE\u05E1\u05E4\u05E8 \u05D2\u05D9\u05DC\u05D9\u05D5\u05DF</label><input id="issue-number" type="number" value="${escXml(String(issue.issue_number || ""))}"></div>
${heroFields}${guideFields}${guideStepsFields}${locationFields}${tipFields}${saleFields}
<script>
const tok = localStorage.getItem('adminToken') || '';
${issue.status === "published" ? `
fetch('/api/subscribers', { headers: {'X-Session-Token': tok} })
  .then(r => r.json())
  .then(d => { if (Array.isArray(d)) document.getElementById('sub-count').textContent = d.length; })
  .catch(() => {});
async function sendToSubs() {
  if (!confirm('\u05DC\u05E9\u05DC\u05D5\u05D7 \u05D0\u05EA \u05D4\u05D2\u05D9\u05DC\u05D9\u05D5\u05DF \u05DC\u05DB\u05DC \u05D4\u05E0\u05E8\u05E9\u05DE\u05D9\u05DD?')) return;
  const btn = document.getElementById('send-btn');
  const msg = document.getElementById('send-msg');
  btn.disabled = true;
  msg.style.display = 'inline'; msg.style.color = '#888'; msg.textContent = '\u05E9\u05D5\u05DC\u05D7...';
  try {
    const r = await fetch('/api/admin/newsletter/${escXml(id)}/send', {
      method: 'POST', headers: {'X-Session-Token': tok}
    });
    const d = await r.json();
    if (d.ok) { msg.style.color = '#4caf50'; msg.textContent = '\u05E0\u05E9\u05DC\u05D7 \u05DC-' + d.sent + ' \u05E0\u05E8\u05E9\u05DE\u05D9\u05DD \u2713'; }
    else { msg.style.color = '#f44336'; msg.textContent = d.error || '\u05E9\u05D2\u05D9\u05D0\u05D4'; }
  } catch { msg.style.color = '#f44336'; msg.textContent = '\u05E9\u05D2\u05D9\u05D0\u05EA \u05E8\u05E9\u05EA'; }
  btn.disabled = false;
}` : ""}
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
  msg.style.display = 'block'; msg.style.color = '#888'; msg.textContent = '\u05E9\u05D5\u05DE\u05E8...';
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
  msg.textContent = d.ok ? '\u05E0\u05E9\u05DE\u05E8!' : (d.error || '\u05E9\u05D2\u05D9\u05D0\u05D4');
}
async function swapPhoto() {
  const msg = document.getElementById('msg');
  msg.style.display = 'block'; msg.style.color = '#888'; msg.textContent = '\u05DE\u05D7\u05DC\u05D9\u05E3 \u05EA\u05DE\u05D5\u05E0\u05D4...';
  try {
    const r = await fetch('/api/admin/newsletter/${escXml(id)}/swap-photo', { method: 'POST', headers: {'X-Session-Token': tok} });
    const d = await r.json();
    if (d.ok) { msg.style.color = '#4caf50'; msg.textContent = '\u05EA\u05DE\u05D5\u05E0\u05D4 \u05D4\u05D5\u05D7\u05DC\u05E4\u05D4! \u05D8\u05D5\u05E2\u05DF...'; setTimeout(() => location.reload(), 700); }
    else { msg.style.color = '#f44336'; msg.textContent = d.error || '\u05E9\u05D2\u05D9\u05D0\u05D4'; }
  } catch { msg.style.color = '#f44336'; msg.textContent = '\u05E9\u05D2\u05D9\u05D0\u05EA \u05E8\u05E9\u05EA'; }
}
async function regenTip() {
  const msg = document.getElementById('msg');
  msg.style.display = 'block'; msg.style.color = '#888'; msg.textContent = '\u05D9\u05D5\u05E6\u05E8 \u05D8\u05D9\u05E4 \u05D7\u05D3\u05E9...';
  try {
    const r = await fetch('/api/admin/newsletter/${escXml(id)}/regen-tip', { method: 'POST', headers: {'X-Session-Token': tok} });
    const d = await r.json();
    if (d.ok) { msg.style.color = '#4caf50'; msg.textContent = '\u05D8\u05D9\u05E4 \u05D7\u05D3\u05E9! \u05D8\u05D5\u05E2\u05DF...'; setTimeout(() => location.reload(), 700); }
    else { msg.style.color = '#f44336'; msg.textContent = d.error || '\u05E9\u05D2\u05D9\u05D0\u05D4'; }
  } catch { msg.style.color = '#f44336'; msg.textContent = '\u05E9\u05D2\u05D9\u05D0\u05EA \u05E8\u05E9\u05EA'; }
}
async function publish() {
  if (!confirm('\u05DC\u05E4\u05E8\u05E1\u05DD \u05D0\u05EA \u05D4\u05D2\u05D9\u05DC\u05D9\u05D5\u05DF?')) return;
  const msg = document.getElementById('msg');
  msg.style.display = 'block'; msg.style.color = '#888'; msg.textContent = '\u05DE\u05E4\u05E8\u05E1\u05DD...';
  const r = await fetch('/api/admin/newsletter/${escXml(id)}/publish', {
    method: 'POST', headers: {'X-Session-Token':tok}
  });
  const d = await r.json();
  if (d.url) { msg.style.color = '#4caf50'; msg.textContent = '\u05E4\u05D5\u05E8\u05E1\u05DD! \u05DE\u05E0\u05EA\u05D1...'; setTimeout(() => location.href = d.url, 800); }
  else { msg.style.color = '#f44336'; msg.textContent = d.error || '\u05E9\u05D2\u05D9\u05D0\u05D4'; }
}
<\/script>
</body></html>`);
}
__name(handleAdminNlEditor, "handleAdminNlEditor");
async function handleAdminNlGenerate(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  const { type, month } = await request.json().catch(() => ({}));
  if (!["full", "flash"].includes(type)) return jsonRes({ error: "type must be full or flash" }, 400, request);
  try {
    const result = await nlGenerateDraft(env, type, month || null);
    return jsonRes(result, 200, request);
  } catch (e) {
    return jsonRes({ error: e.message }, 500, request);
  }
}
__name(handleAdminNlGenerate, "handleAdminNlGenerate");
async function handleAdminNlUpdate(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "PATCH") return jsonRes({ error: "method not allowed" }, 405, request);
  const body = await request.json().catch(() => ({}));
  const issue = body.issue_number !== void 0 ? await env.DB.prepare("SELECT type, title_he, title_en FROM newsletter_issues WHERE id=?").bind(id).first() : null;
  const updates = [];
  const binds = [];
  if (body.title_he !== void 0) {
    updates.push("title_he=?");
    binds.push(body.title_he);
  }
  if (body.title_en !== void 0) {
    updates.push("title_en=?");
    binds.push(body.title_en);
  }
  if (body.content_json !== void 0) {
    updates.push("content_json=?");
    binds.push(body.content_json);
  }
  if (body.issue_number !== void 0) {
    updates.push("issue_number=?");
    binds.push(body.issue_number);
    if (issue && issue.type === "full") {
      const n = body.issue_number;
      const newHe = (issue.title_he || "").replace(/גיליון #\d+/, `\u05D2\u05D9\u05DC\u05D9\u05D5\u05DF #${n}`);
      const newEn = (issue.title_en || "").replace(/Issue #\d+/, `Issue #${n}`);
      if (newHe !== issue.title_he && !body.title_he) {
        updates.push("title_he=?");
        binds.push(newHe);
      }
      if (newEn !== issue.title_en && !body.title_en) {
        updates.push("title_en=?");
        binds.push(newEn);
      }
    }
  }
  if (!updates.length) return jsonRes({ error: "no fields to update" }, 400, request);
  binds.push(id);
  await env.DB.prepare(`UPDATE newsletter_issues SET ${updates.join(",")} WHERE id=?`).bind(...binds).run();
  if (body.issue_number !== void 0)
    await nlSetSetting(env, "nl_issue_number", String(Math.max(0, body.issue_number - 1)));
  return jsonRes({ ok: true }, 200, request);
}
__name(handleAdminNlUpdate, "handleAdminNlUpdate");
async function handleAdminNlPublish(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  const issue = await env.DB.prepare("SELECT slug, status FROM newsletter_issues WHERE id=?").bind(id).first();
  if (!issue) return jsonRes({ error: "not found" }, 404, request);
  await env.DB.prepare(
    `UPDATE newsletter_issues SET status='published', published_at=? WHERE id=?`
  ).bind((/* @__PURE__ */ new Date()).toISOString(), id).run();
  return jsonRes({ ok: true, url: `/newsletter/${issue.slug}/` }, 200, request);
}
__name(handleAdminNlPublish, "handleAdminNlPublish");
async function handleAdminNlSwapPhoto(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  const issue = await env.DB.prepare("SELECT * FROM newsletter_issues WHERE id=?").bind(id).first();
  if (!issue) return jsonRes({ error: "not found" }, 404, request);
  const c = JSON.parse(issue.content_json || "{}");
  const currentPhotoId = c.hero?.photo_id || "";
  const newPhoto = await env.DB.prepare(
    "SELECT id, title, url, thumbnail, category FROM photos WHERE published=1 AND id != ? ORDER BY RANDOM() LIMIT 1"
  ).bind(currentPhotoId).first();
  if (!newPhoto) return jsonRes({ error: "no other photos available" }, 400, request);
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonRes({ error: "ANTHROPIC_API_KEY not set" }, 500, request);
  const userPrompt = issue.type === "full" ? `\u05DB\u05EA\u05D5\u05D1 \u05EA\u05D5\u05DB\u05DF \u05DC\u05E0\u05D9\u05D5\u05D6\u05DC\u05D8\u05E8 \u05E6\u05D9\u05DC\u05D5\u05DD. \u05D4\u05D7\u05D6\u05E8 JSON \u05D1\u05DC\u05D1\u05D3:
{"hero_text_he": "\u05E4\u05E1\u05E7\u05D4 \u05E7\u05E6\u05E8\u05D4 (2-3 \u05DE\u05E9\u05E4\u05D8\u05D9\u05DD) \u05D1\u05E2\u05D1\u05E8\u05D9\u05EA \u05E2\u05DC \u05D4\u05EA\u05DE\u05D5\u05E0\u05D4", "hero_text_en": "same in English"}

\u05EA\u05DE\u05D5\u05E0\u05D4: "${newPhoto.title}" (\u05E7\u05D8\u05D2\u05D5\u05E8\u05D9\u05D4: ${newPhoto.category || "\u05D8\u05D1\u05E2"})` : `\u05DB\u05EA\u05D5\u05D1 \u05EA\u05D5\u05DB\u05DF \u05DC\u05D4\u05D1\u05D6\u05E7. \u05D4\u05D7\u05D6\u05E8 JSON \u05D1\u05DC\u05D1\u05D3:
{"hero_text_he": "1-2 \u05DE\u05E9\u05E4\u05D8\u05D9\u05DD \u05D0\u05D9\u05E9\u05D9\u05D9\u05DD \u05E2\u05DC \u05D4\u05EA\u05DE\u05D5\u05E0\u05D4", "hero_text_en": "same in English"}

\u05EA\u05DE\u05D5\u05E0\u05D4: "${newPhoto.title}" (\u05E7\u05D8\u05D2\u05D5\u05E8\u05D9\u05D4: ${newPhoto.category || "\u05D8\u05D1\u05E2"})`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-opus-4-7",
      max_tokens: 500,
      system: "\u05D0\u05EA\u05D4 \u05DB\u05D5\u05EA\u05D1 \u05D1\u05E9\u05DE\u05D5 \u05E9\u05DC \u05E2\u05DE\u05D9\u05EA, \u05E6\u05DC\u05DD \u05D9\u05E9\u05E8\u05D0\u05DC\u05D9. \u05DB\u05EA\u05D5\u05D1 \u05EA\u05DE\u05D9\u05D3 \u05D1\u05D2\u05D5\u05E3 \u05E8\u05D0\u05E9\u05D5\u05DF. \u05D4\u05D7\u05D6\u05E8 JSON \u05EA\u05E7\u05D9\u05DF \u05D1\u05DC\u05D1\u05D3, \u05DC\u05DC\u05D0 \u05E9\u05D5\u05DD \u05D8\u05E7\u05E1\u05D8 \u05E0\u05D5\u05E1\u05E3.",
      messages: [{ role: "user", content: userPrompt }]
    })
  });
  if (!res.ok) return jsonRes({ error: `Claude API ${res.status}` }, 500, request);
  const data = await res.json();
  const raw = (data.content?.[0]?.text ?? "").trim();
  const jsonStr = raw.startsWith("```") ? raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "") : raw;
  let generated;
  try {
    generated = JSON.parse(jsonStr);
  } catch {
    return jsonRes({ error: "Claude JSON parse failed" }, 500, request);
  }
  c.hero = {
    ...c.hero,
    photo_id: newPhoto.id,
    photo_url: toAbsolutePhotoUrl(newPhoto.url || newPhoto.thumbnail),
    title_he: newPhoto.title,
    category: newPhoto.category || "",
    text_he: generated.hero_text_he || c.hero?.text_he || "",
    text_en: generated.hero_text_en || c.hero?.text_en || ""
  };
  await env.DB.prepare("UPDATE newsletter_issues SET content_json=? WHERE id=?").bind(JSON.stringify(c), id).run();
  await nlSetSetting(env, "nl_last_hero_id", newPhoto.id);
  return jsonRes({ ok: true }, 200, request);
}
__name(handleAdminNlSwapPhoto, "handleAdminNlSwapPhoto");
async function handleAdminNlRegenTip(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  const issue = await env.DB.prepare("SELECT * FROM newsletter_issues WHERE id=?").bind(id).first();
  if (!issue) return jsonRes({ error: "not found" }, 404, request);
  const c = JSON.parse(issue.content_json || "{}");
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonRes({ error: "ANTHROPIC_API_KEY not set" }, 500, request);
  const userPrompt = `\u05DB\u05EA\u05D5\u05D1 \u05D8\u05D9\u05E4 \u05E6\u05D9\u05DC\u05D5\u05DD \u05DE\u05E7\u05D5\u05E8\u05D9 \u05D5\u05E4\u05E8\u05E7\u05D8\u05D9. \u05D4\u05D7\u05D6\u05E8 JSON \u05D1\u05DC\u05D1\u05D3:
{"tip_title_he": "\u05DB\u05D5\u05EA\u05E8\u05EA \u05E7\u05E6\u05E8\u05D4 (5-7 \u05DE\u05D9\u05DC\u05D9\u05DD)", "tip_title_en": "short tip title", "tip_text_he": "\u05D8\u05D9\u05E4 \u05DE\u05E7\u05D5\u05E8\u05D9 \u05D5\u05E4\u05E8\u05E7\u05D8\u05D9, 2-3 \u05DE\u05E9\u05E4\u05D8\u05D9\u05DD, \u05DC\u05D0 \u05D2\u05E0\u05E8\u05D9", "tip_text_en": "same in English"}

\u05D4\u05E7\u05E9\u05E8: \u05EA\u05DE\u05D5\u05E0\u05D4 "${c.hero?.title_he || ""}" (\u05E7\u05D8\u05D2\u05D5\u05E8\u05D9\u05D4: ${c.hero?.category || "\u05D8\u05D1\u05E2"})`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-opus-4-7",
      max_tokens: 400,
      system: "\u05D0\u05EA\u05D4 \u05DB\u05D5\u05EA\u05D1 \u05D1\u05E9\u05DE\u05D5 \u05E9\u05DC \u05E2\u05DE\u05D9\u05EA, \u05E6\u05DC\u05DD \u05D9\u05E9\u05E8\u05D0\u05DC\u05D9. \u05DB\u05EA\u05D5\u05D1 \u05EA\u05DE\u05D9\u05D3 \u05D1\u05D2\u05D5\u05E3 \u05E8\u05D0\u05E9\u05D5\u05DF. \u05D4\u05D7\u05D6\u05E8 JSON \u05EA\u05E7\u05D9\u05DF \u05D1\u05DC\u05D1\u05D3, \u05DC\u05DC\u05D0 \u05E9\u05D5\u05DD \u05D8\u05E7\u05E1\u05D8 \u05E0\u05D5\u05E1\u05E3.",
      messages: [{ role: "user", content: userPrompt }]
    })
  });
  if (!res.ok) return jsonRes({ error: `Claude API ${res.status}` }, 500, request);
  const data = await res.json();
  const raw = (data.content?.[0]?.text ?? "").trim();
  const jsonStr = raw.startsWith("```") ? raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "") : raw;
  let generated;
  try {
    generated = JSON.parse(jsonStr);
  } catch {
    return jsonRes({ error: "Claude JSON parse failed" }, 500, request);
  }
  c.tip = {
    title_he: generated.tip_title_he || c.tip?.title_he || "\u05D8\u05D9\u05E4 \u05D4\u05D7\u05D5\u05D3\u05E9",
    title_en: generated.tip_title_en || c.tip?.title_en || "",
    text_he: generated.tip_text_he || c.tip?.text_he || "",
    text_en: generated.tip_text_en || c.tip?.text_en || ""
  };
  await env.DB.prepare("UPDATE newsletter_issues SET content_json=? WHERE id=?").bind(JSON.stringify(c), id).run();
  return jsonRes({ ok: true }, 200, request);
}
__name(handleAdminNlRegenTip, "handleAdminNlRegenTip");
function nlBuildEmailHtml(issue, issueUrl, unsubscribeUrl, subscriberName) {
  const c = typeof issue.content_json === "string" ? JSON.parse(issue.content_json || "{}") : issue.content_json || {};
  const greeting = subscriberName ? `<p style="margin:0 0 16px;font-size:14px;color:#d0cdc8">\u05E9\u05DC\u05D5\u05DD ${escXml(subscriberName)},</p>` : "";
  const heroHtml = c.hero ? `
    <img src="${escXml(c.hero.photo_url)}" alt="${escXml(c.hero.title_he)}" width="560" style="width:100%;max-width:560px;height:auto;display:block;border-radius:8px;margin-bottom:16px">
    <h2 style="margin:0 0 8px;font-size:18px;color:#c8a96e;font-family:Georgia,serif">${escXml(c.hero.title_he)}</h2>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#d0cdc8">${escXml(c.hero.text_he)}</p>` : "";
  const guideHtml = c.guide ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
      <tr><td style="background:#1a1a1a;border-radius:8px;padding:14px 16px">
        <div style="font-size:10px;color:#c8a96e;letter-spacing:.1em;margin-bottom:6px;text-transform:uppercase">\u05DE\u05D3\u05E8\u05D9\u05DA \u05D4\u05D7\u05D5\u05D3\u05E9</div>
        <div style="font-size:14px;font-weight:700;color:#f0ede8;margin-bottom:6px">${escXml(c.guide.title_he)}</div>
        <p style="margin:0;font-size:13px;color:#999;line-height:1.6">${escXml(c.guide.text_he)}</p>
      </td></tr>
    </table>` : "";
  const tipHtml = c.tip ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
      <tr><td style="background:#1f1a10;border:1px solid #4a3a1a;border-radius:8px;padding:14px 16px">
        <div style="font-size:13px;font-weight:700;color:#c8a96e;margin-bottom:6px">${escXml(c.tip.title_he || "\u05D8\u05D9\u05E4 \u05D4\u05D7\u05D5\u05D3\u05E9")}</div>
        <p style="margin:0;font-size:13px;color:#d0cdc8;line-height:1.6">${escXml(c.tip.text_he)}</p>
      </td></tr>
    </table>` : "";
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
            <a href="${escXml(issueUrl)}" style="display:inline-block;background:#c8a96e;color:#000;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none">\u05E7\u05E8\u05D0 \u05D0\u05EA \u05D4\u05D2\u05D9\u05DC\u05D9\u05D5\u05DF \u05D4\u05DE\u05DC\u05D0 \u2190</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:16px 32px 8px;text-align:center">
        <a href="https://ko-fi.com/amitphotos" style="display:inline-block;background:#f5f0e8;color:#7c5c2e;font-size:13px;font-weight:700;padding:10px 22px;border-radius:8px;text-decoration:none">&#9749; \u05D0\u05D4\u05D1\u05EA \u05D0\u05EA \u05D4\u05D2\u05D9\u05DC\u05D9\u05D5\u05DF? \u05E7\u05E0\u05D4 \u05DC\u05D9 \u05E7\u05E4\u05D4</a>
      </td></tr>
      <tr><td style="padding:8px 32px 24px;text-align:center;border-top:1px solid #222;margin-top:8px">
        <p style="margin:8px 0 8px;color:#666;font-size:11px">\u05E7\u05D9\u05D1\u05DC\u05EA \u05DE\u05D9\u05D9\u05DC \u05D6\u05D4 \u05DB\u05D9 \u05E0\u05E8\u05E9\u05DE\u05EA \u05DC<a href="https://amitphotos.com" style="color:#c8a96e;text-decoration:none">amitphotos.com</a></p>
        <a href="${escXml(unsubscribeUrl)}" style="color:#888;font-size:12px;text-decoration:underline">Unsubscribe / \u05D4\u05E1\u05E8 \u05D0\u05D5\u05EA\u05D9 \u05DE\u05D4\u05E8\u05E9\u05D9\u05DE\u05D4</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
__name(nlBuildEmailHtml, "nlBuildEmailHtml");
async function handleAdminNlDelete(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "DELETE") return jsonRes({ error: "method not allowed" }, 405, request);
  const issue = await env.DB.prepare("SELECT id FROM newsletter_issues WHERE id=?").bind(id).first();
  if (!issue) return jsonRes({ error: "not found" }, 404, request);
  await env.DB.prepare("DELETE FROM newsletter_issues WHERE id=?").bind(id).run();
  return jsonRes({ ok: true }, 200, request);
}
__name(handleAdminNlDelete, "handleAdminNlDelete");
async function handleAdminNlSendTest(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  if (!env.RESEND_API_KEY) return jsonRes({ error: "RESEND_API_KEY \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8" }, 500, request);
  const body = await request.json().catch(() => ({}));
  const email = (body.email || "").trim();
  if (!email) return jsonRes({ error: "\u05D7\u05E1\u05E8 \u05DB\u05EA\u05D5\u05D1\u05EA \u05DE\u05D9\u05D9\u05DC" }, 400, request);
  const issue = await env.DB.prepare("SELECT * FROM newsletter_issues WHERE id=?").bind(id).first();
  if (!issue) return jsonRes({ error: "not found" }, 404, request);
  const origin = new URL(request.url).origin;
  const issueUrl = `${origin}/newsletter/${issue.slug}/`;
  const fromEmail = env.FROM_EMAIL || "amit@amitphotos.com";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: email,
      subject: `[\u05D1\u05D3\u05D9\u05E7\u05D4] ${issue.title_he}`,
      html: nlBuildEmailHtml(issue, issueUrl, null, "")
    })
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    return jsonRes({ error: `\u05E9\u05D2\u05D9\u05D0\u05EA Resend: ${errBody.message || res.status}` }, 500, request);
  }
  return jsonRes({ ok: true }, 200, request);
}
__name(handleAdminNlSendTest, "handleAdminNlSendTest");
async function handleAdminNlSend(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== "POST") return jsonRes({ error: "method not allowed" }, 405, request);
  if (!env.RESEND_API_KEY) return jsonRes({ error: "RESEND_API_KEY \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8" }, 500, request);
  const issue = await env.DB.prepare("SELECT * FROM newsletter_issues WHERE id=?").bind(id).first();
  if (!issue) return jsonRes({ error: "not found" }, 404, request);
  if (issue.status !== "published") return jsonRes({ error: "\u05D9\u05E9 \u05DC\u05E4\u05E8\u05E1\u05DD \u05D0\u05EA \u05D4\u05D2\u05D9\u05DC\u05D9\u05D5\u05DF \u05DC\u05E4\u05E0\u05D9 \u05E9\u05DC\u05D9\u05D7\u05D4" }, 400, request);
  const { results: subscribers } = await env.DB.prepare("SELECT id, email, name FROM subscribers").all();
  if (!subscribers.length) return jsonRes({ error: "\u05D0\u05D9\u05DF \u05E0\u05E8\u05E9\u05DE\u05D9\u05DD \u05D1\u05E8\u05E9\u05D9\u05DE\u05D4" }, 400, request);
  const origin = new URL(request.url).origin;
  const issueUrl = `${origin}/newsletter/${issue.slug}/`;
  const fromEmail = env.FROM_EMAIL || "amit@amitphotos.com";
  const batch = subscribers.map((sub) => ({
    from: fromEmail,
    to: sub.email,
    subject: issue.title_he,
    html: nlBuildEmailHtml(issue, issueUrl, `${origin}/api/unsubscribe?token=${sub.id}`, sub.name)
  }));
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(batch)
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    return jsonRes({ error: `\u05E9\u05D2\u05D9\u05D0\u05EA Resend: ${errBody.message || res.status}` }, 500, request);
  }
  const data = await res.json().catch(() => ({}));
  const sent = Array.isArray(data.data) ? data.data.length : subscribers.length;
  return jsonRes({ ok: true, sent }, 200, request);
}
__name(handleAdminNlSend, "handleAdminNlSend");
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (url.hostname === "www.amitphotos.com") {
      return Response.redirect("https://amitphotos.com" + url.pathname + url.search, 301);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (path === "/api/login") return handleLogin(request, env);
    if (path === "/api/logout") return handleLogout(request, env);
    if (path === "/api/forgot-password") return handleForgotPassword(request, env);
    if (path === "/api/reset-password") return handleResetPassword(request, env);
    if (path === "/api/subscribers") return handleSubscribers(request, env);
    if (path === "/api/customers") return handleCustomers(request, env);
    if (path === "/api/photos") return handlePhotos(request, env);
    if (path === "/api/quiz-photos") return handleQuizPhotos(request, env);
    if (path === "/api/sale-photos") return handleSalePhotos(request, env);
    if (path === "/api/sale/rotate" && request.method === "POST") return handleSaleRotate(request, env);
    if (path === "/api/upload") return handleUpload(request, env, ctx);
    if (path === "/api/repair-r2") return handleRepairR2(request, env);
    if (path === "/api/track" && request.method === "POST") return handleTrackEvent(request, env);
    if (path === "/api/pinterest/auth") return handlePinterestAuth(request, env);
    if (path === "/api/pinterest/callback") return handlePinterestCallback(request, env);
    if (path === "/api/pinterest/boards") return handlePinterestBoards(request, env);
    if (path === "/api/pinterest/status") return handlePinterestStatus(request, env);
    if (path === "/api/pinterest/post" && request.method === "POST") return handlePinterestPost(request, env);
    if (path === "/api/pinterest/sync-all" && request.method === "POST") return handlePinterestSyncAll(request, env);
    if (path === "/api/pinterest/sync-by-category" && request.method === "POST") return handlePinterestSyncByCategory(request, env);
    if (path === "/api/pinterest/update-links" && request.method === "POST") return handlePinterestUpdateLinks(request, env);
    if (path === "/api/pinterest/sync-en" && request.method === "POST") return handlePinterestSyncEn(request, env);
    if (path === "/api/admin/photo-analytics") return handleAdminPhotoAnalytics(request, env);
    if (path === "/api/fill-titles") return handleFillTitles(request, env);
    if (path === "/api/generate-alt") return handleGenerateAlt(request, env);
    if (path === "/api/trigger-workflow") return handleTriggerWorkflow(request, env);
    if (path === "/api/breakdown" && request.method === "POST") return handleBreakdown(request, env);
    if (path === "/api/reels") return handleReels(request, env);
    if (path.startsWith("/api/reels/file/")) return handleReelsFile(request, env, path.slice("/api/reels/file/".length));
    if (path.startsWith("/video/")) return handleVideoFile(request, env, path.slice("/video/".length));
    if (path === "/api/admin/videos") return handleAdminVideos(request, env);
    if (path === "/api/newsletter") return handleNewsletter(request, env);
    if (path === "/api/unsubscribe") return handleUnsubscribe(request, env);
    if (path === "/api/reply") return handleReply(request, env);
    if (path === "/api/verify-payment") return handleVerifyPayment(request, env, ctx);
    if (path === "/api/admin/purchases") return handleAdminPurchases(request, env);
    if (path === "/api/admin/create-token" && request.method === "POST") return handleAdminCreateToken(request, env);
    if (path === "/api/new-badge-settings") return handleNewBadgeSettings(request, env);
    if (path === "/api/admin/prices") return handleAdminPrices(request, env);
    if (path === "/api/admin/photo-price" && request.method === "POST") return handleAdminPhotoPrice(request, env);
    if (path === "/api/photos/reorder" && request.method === "POST") return handlePhotosReorder(request, env);
    if (path === "/api/admin/photo-of-week/suggest" && request.method === "POST") return handlePhotoOfWeekSuggest(request, env);
    if (path === "/api/admin/photo-of-week/set" && request.method === "POST") return handlePhotoOfWeekSet(request, env);
    if (path === "/api/admin/photo-of-week/clear" && request.method === "POST") return handlePhotoOfWeekClear(request, env);
    if (path === "/api/admin/photo-of-week/caption" && request.method === "POST") return handlePhotoOfWeekCaption(request, env);
    if (path === "/api/admin/toggle-photo-new" && request.method === "POST") return handleTogglePhotoNew(request, env);
    if (path === "/api/admin/featured") return handleAdminFeatured(request, env);
    if (path === "/api/admin/upload-story" && request.method === "POST") return handleUploadStory(request, env);
    if (path.startsWith("/api/admin/replace-photo/") && request.method === "POST") return handleAdminReplacePhoto(request, env, path.slice("/api/admin/replace-photo/".length));
    if (path === "/api/admin/photo-dimensions" && request.method === "POST") return handleAdminPhotoDimensions(request, env);
    if (path === "/free-guide" || path === "/free-guide/") return handleFreeGuide(request, env);
    if (path === "/prices") return handlePricesPage(request, env);
    if (path === "/api/admin/migrate-amount" && request.method === "POST") {
      if (!await checkAuth(request, env)) return unauth(request);
      await env.DB.prepare("ALTER TABLE download_tokens ADD COLUMN amount REAL DEFAULT 0").run().catch(() => {
      });
      return jsonRes({ ok: true }, 200, request);
    }
    if (path === "/api/admin/migrate-photo-dimensions" && request.method === "POST") {
      if (!await checkAuth(request, env)) return unauth(request);
      await env.DB.prepare("ALTER TABLE photos ADD COLUMN width INTEGER").run().catch(() => {
      });
      await env.DB.prepare("ALTER TABLE photos ADD COLUMN height INTEGER").run().catch(() => {
      });
      return jsonRes({ ok: true }, 200, request);
    }
    if (path === "/api/admin/photos/sync-thumbnails" && request.method === "POST") {
      if (!await checkAuth(request, env)) return unauth(request);
      const body = await request.json().catch(() => ({}));
      const photos = Array.isArray(body.photos) ? body.photos : [];
      if (!photos.length) return jsonRes({ error: "no photos" }, 400, request);
      let updated = 0;
      const stmts = photos.map(
        (p) => env.DB.prepare("UPDATE photos SET thumbnail=?, url=? WHERE id=? AND (thumbnail != ? OR thumbnail LIKE '%lh3.googleusercontent%')").bind(p.thumbnail, p.url, p.id, p.thumbnail)
      );
      for (let i = 0; i < stmts.length; i += 100) {
        const batch = stmts.slice(i, i + 100);
        const results = await env.DB.batch(batch);
        updated += results.reduce((s, r) => s + (r.meta?.changes || 0), 0);
      }
      return jsonRes({ ok: true, updated }, 200, request);
    }
    if (path === "/api/admin/photos/translate-titles" && request.method === "POST") {
      if (!await checkAuth(request, env)) return unauth(request);
      await env.DB.prepare("ALTER TABLE photos ADD COLUMN title_en TEXT DEFAULT ''").run().catch(() => {
      });
      const { limit: bLimit } = await request.json().catch(() => ({}));
      const batchSize = Math.min(parseInt(bLimit) || 30, 50);
      const { results: batch } = await env.DB.prepare(
        "SELECT id, title, description, category FROM photos WHERE (title_en IS NULL OR title_en = '') AND published = 1 ORDER BY created_at DESC LIMIT ?"
      ).bind(batchSize).all();
      const { results: totalRow } = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM photos WHERE (title_en IS NULL OR title_en = '') AND published = 1"
      ).all();
      const remaining = totalRow[0]?.cnt || 0;
      if (!batch.length) return jsonRes({ ok: true, done: 0, remaining: 0 }, 200, request);
      const results = await Promise.allSettled(batch.map(async (p) => {
        const en = await translateTitleEn(p.title, p.description, p.category, env);
        if (en) await env.DB.prepare("UPDATE photos SET title_en=? WHERE id=?").bind(en, p.id).run();
        return { id: p.id, title_en: en };
      }));
      const done = results.filter((r) => r.status === "fulfilled" && r.value?.title_en).length;
      return jsonRes({ ok: true, done, remaining: remaining - done }, 200, request);
    }
    if (path === "/api/admin/migrate-analyses" && request.method === "POST") return handleMigrateAnalyses(request, env);
    if (path === "/api/analyses" && request.method === "GET") return handleAnalysesList(request, env);
    if (path === "/api/analyses/dedup" && request.method === "POST") return handleAnalysesDedup(request, env);
    if (path === "/api/analyses/publish-all" && request.method === "POST") return handleAnalysesPublishAll(request, env);
    if (path === "/api/analyses/generate" && request.method === "POST") return handleAnalysesGenerate(request, env);
    if (path.startsWith("/api/analyses/") && path.endsWith("/generate-en") && request.method === "POST")
      return handleAnalysesGenerateEn(request, env, path.slice("/api/analyses/".length).replace("/generate-en", ""));
    if (path.startsWith("/api/analyses/") && request.method === "GET") return handleAnalysesGet(request, env, path.slice("/api/analyses/".length));
    if (path.startsWith("/api/analyses/") && request.method === "PUT") return handleAnalysesUpdate(request, env, path.slice("/api/analyses/".length));
    if (path.startsWith("/api/analyses/") && request.method === "DELETE") return handleAnalysesDelete(request, env, path.slice("/api/analyses/".length));
    if (path === "/api/locations" && request.method === "GET") return handleLocationsList(request, env);
    if (path === "/api/locations/suggest" && request.method === "POST") return handleLocationsSuggest(request, env);
    if (path.startsWith("/api/locations/") && request.method === "GET") return handleLocationsGet(request, env, path.slice("/api/locations/".length));
    if (path === "/api/admin/locations" && request.method === "GET") return handleAdminLocationsList(request, env);
    if (path === "/api/admin/locations" && request.method === "POST") return handleAdminLocationsCreate(request, env);
    if (path.startsWith("/api/admin/locations/") && request.method === "GET")
      return handleAdminLocationsGet(request, env, path.slice("/api/admin/locations/".length).split("/")[0]);
    if (path.startsWith("/api/admin/locations/") && request.method === "PUT") {
      const slug = path.slice("/api/admin/locations/".length).split("/")[0];
      return handleAdminLocationsUpdate(request, env, slug);
    }
    if (path.startsWith("/api/admin/locations/") && request.method === "POST") {
      const afterPrefix = path.slice("/api/admin/locations/".length);
      const parts = afterPrefix.split("/");
      const locSlug = parts[0];
      if (parts[1] === "generate-en") return handleAdminLocationsGenerateEn(request, env, locSlug);
      if (parts[1] === "enrich") return handleAdminLocationsEnrich(request, env, locSlug);
      if (parts[1] === "photos") {
        if (parts[2] === "reorder") return handleAdminLocationPhotosReorder(request, env, locSlug);
        if (parts[2] && parts[3] === "add-to-gallery") return handleAdminLocationPhotoAddToGallery(request, env, locSlug, parts[2]);
        if (parts[2] && parts[3] === "forsale") {
          if (!await checkAuth(request, env)) return unauth(request);
          const { for_sale } = await request.json().catch(() => ({}));
          await env.DB.prepare("UPDATE location_photos SET for_sale = ? WHERE id = ? AND location_id = ?").bind(for_sale ? 1 : 0, parts[2], locSlug).run();
          return jsonRes({ ok: true }, 200, request);
        }
        return handleAdminLocationPhotosAdd(request, env, locSlug);
      }
      return jsonRes({ error: "\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" }, 404, request);
    }
    if (path.startsWith("/api/admin/locations/") && request.method === "DELETE") {
      const afterPrefix = path.slice("/api/admin/locations/".length);
      const parts = afterPrefix.split("/");
      if (parts[1] === "photos" && parts[2]) {
        return handleAdminLocationPhotosDelete(request, env, parts[0], parts[2]);
      }
      return handleAdminLocationsDelete(request, env, parts[0]);
    }
    if (path.startsWith("/api/download/")) return handleDownload(request, env, path.slice("/api/download/".length));
    if (path === "/api/print/catalog") return handlePrintCatalog(request, env);
    if (path === "/api/print/quote") return handlePrintQuote(request, env);
    if (path === "/api/print/upload-crop") return handlePrintUploadCrop(request, env);
    if (path === "/api/print/order-complete") return handlePrintOrderComplete(request, env);
    if (path === "/api/print/cancel") return handlePrintCancel(request, env);
    if (path === "/api/print/webhook") return handlePrintWebhook(request, env);
    if (path === "/api/print/refresh-status") return handlePrintRefreshStatus(request, env);
    if (path === "/api/print/orders") return handlePrintOrders(request, env);
    if (path === "/api/proxy-image") return handleImageProxy(request, env);
    if (path === "/api/analytics") return handleAnalytics(request, env);
    if (path.startsWith("/photos/")) return servePhoto(path.slice("/photos/".length), env, request);
    if (path.startsWith("/photo/")) {
      trackPageView(env, request, "photo");
      return servePhotoPage(path.slice("/photo/".length), env);
    }
    if (path.startsWith("/category/")) {
      trackPageView(env, request, "category");
      return handleCategoryPage(decodeURIComponent(path.slice("/category/".length)), env);
    }
    if (path === "/newsletter" || path === "/newsletter/") return handleNlList(env);
    if (path.startsWith("/newsletter/") && path.length > "/newsletter/".length) {
      const slug = path.slice("/newsletter/".length).replace(/\/$/, "");
      return handleNlIssue(env, slug, false);
    }
    if (path === "/admin/newsletter" || path === "/admin/newsletter/") return handleAdminNlList(request, env);
    if (path.match(/^\/admin\/newsletter\/[^/]+\/preview\/?$/)) {
      const id = path.slice("/admin/newsletter/".length).replace(/\/preview\/?$/, "");
      if (!await checkAuth(request, env)) return new Response("Unauthorized", { status: 401 });
      const issue = await env.DB.prepare("SELECT * FROM newsletter_issues WHERE id=?").bind(id).first();
      return issue ? handleNlIssue(env, issue.slug, true) : new Response("Not found", { status: 404 });
    }
    if (path.match(/^\/admin\/newsletter\/[^/]+\/?$/)) {
      const id = path.slice("/admin/newsletter/".length).replace(/\/$/, "");
      return handleAdminNlEditor(request, env, id);
    }
    if (path === "/api/admin/newsletter/generate" && request.method === "POST") return handleAdminNlGenerate(request, env);
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+$/) && request.method === "GET") {
      if (!await checkAuth(request, env)) return unauth(request);
      const id = path.slice("/api/admin/newsletter/".length);
      const issue = await env.DB.prepare("SELECT * FROM newsletter_issues WHERE id=? OR slug=?").bind(id, id).first();
      return issue ? jsonRes(issue, 200, request) : jsonRes({ error: "not found" }, 404, request);
    }
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+$/) && request.method === "PATCH") {
      const id = path.slice("/api/admin/newsletter/".length);
      return handleAdminNlUpdate(request, env, id);
    }
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+\/publish$/) && request.method === "POST") {
      const id = path.slice("/api/admin/newsletter/".length).replace(/\/publish$/, "");
      return handleAdminNlPublish(request, env, id);
    }
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+\/send$/) && request.method === "POST") {
      const id = path.slice("/api/admin/newsletter/".length).replace(/\/send$/, "");
      return handleAdminNlSend(request, env, id);
    }
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+\/send-test$/) && request.method === "POST") {
      const id = path.slice("/api/admin/newsletter/".length).replace(/\/send-test$/, "");
      return handleAdminNlSendTest(request, env, id);
    }
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+\/swap-photo$/) && request.method === "POST") {
      const id = path.slice("/api/admin/newsletter/".length).replace(/\/swap-photo$/, "");
      return handleAdminNlSwapPhoto(request, env, id);
    }
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+\/regen-tip$/) && request.method === "POST") {
      const id = path.slice("/api/admin/newsletter/".length).replace(/\/regen-tip$/, "");
      return handleAdminNlRegenTip(request, env, id);
    }
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+$/) && request.method === "DELETE") {
      const id = path.slice("/api/admin/newsletter/".length);
      return handleAdminNlDelete(request, env, id);
    }
    if (path.startsWith("/learn/") && path.length > "/learn/".length) {
      trackPageView(env, request, "learn_detail");
      return handleLearnAnalysis(env, decodeURIComponent(path.slice("/learn/".length)));
    }
    if (path === "/learn" || path === "/learn/") {
      trackPageView(env, request, "learn");
      return handleLearnIndex(env);
    }
    if (path === "/sitemap.xml") return handleSitemap(request, env);
    if (path === "/robots.txt") return handleRobots(request);
    if ((path === "/locations/spot/" || path === "/locations/spot/index.html") && (new URL(request.url).searchParams.get("slug") || new URL(request.url).searchParams.get("id"))) {
      trackPageView(env, request, "location");
      return handleLocationSpotPage(request, env);
    }
    const res = await env.ASSETS.fetch(request);
    if (request.method === "GET" && !path.startsWith("/api/") && (path === "/" || path.endsWith(".html") || path === "")) {
      const staticPage = path === "/" || path === "" ? "home" : path.startsWith("/camera/") ? "camera" : path.startsWith("/games/") || path.startsWith("/quiz/") || path.startsWith("/puzzle/") ? "games" : path.startsWith("/sale/") ? "sale" : path.startsWith("/locations/") ? "locations" : "other";
      trackPageView(env, request, staticPage);
    }
    const ext = path.includes(".") ? path.split(".").pop().toLowerCase() : "";
    const isHtml = ext === "html" || ext === "" || path === "/";
    const isDynamic = isHtml || ["js", "css", "json"].includes(ext);
    if (isDynamic) {
      const newRes = new Response(res.body, res);
      newRes.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
      newRes.headers.set("CDN-Cache-Control", "no-store");
      newRes.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
      return newRes;
    }
    return res;
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPinterestCronSync(env));
    ctx.waitUntil(runNewsletterCron(env));
  }
};
async function runPinterestCronSync(env) {
  try {
    const token = await getPinterestToken(env);
    if (!token) return;
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
        const pinRes = await fetch("https://api.pinterest.com/v5/pins", {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            link: `https://amitphotos.com/?photo=${photo.id}&buy=1`,
            title: photo.title || "",
            description: (photo.description || "") + "\n\n\u05E2\u05DE\u05D9\u05EA \u05D0\u05E8\u05D6 \u05E6\u05D9\u05DC\u05D5\u05DD | amitphotos.com",
            board_id: boardId,
            media_source: { source_type: "image_url", url: toAbsolutePhotoUrl(photo.url) }
          })
        });
        const pinData = await pinRes.json();
        if (pinData.id) await env.DB.prepare(`UPDATE photos SET pinterest_pin_id=? WHERE id=?`).bind(pinData.id, photo.id).run();
      } catch {
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    await new Promise((r) => setTimeout(r, 3e3));
    const { results: enResults } = await env.DB.prepare(
      `SELECT * FROM photos WHERE (pinterest_pin_id_en IS NULL OR pinterest_pin_id_en='') AND published=1 AND r2_key IS NOT NULL AND r2_key != '' ORDER BY created_at DESC LIMIT 3`
    ).all();
    for (const photo of enResults) {
      try {
        const [boardIdEn, titleEn] = await Promise.all([
          findOrCreateBoardEn(photo.category, env, token),
          translateTitleEn(photo.title, photo.description, photo.category, env)
        ]);
        if (!boardIdEn) continue;
        const englishCategory = HE_TO_EN_CATEGORY[photo.category] || photo.category;
        const pinRes = await fetch("https://api.pinterest.com/v5/pins", {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            link: `https://amitphotos.com/?photo=${photo.id}&buy=1`,
            title: titleEn || `${englishCategory} | Amit Erez`,
            description: `Fine art photography by Israeli photographer Amit Erez.
${englishCategory}. Available as high-quality prints at amitphotos.com.
#photography #fineartphotography #israeliphotographer #amiterezphotography`,
            board_id: boardIdEn,
            media_source: { source_type: "image_url", url: toAbsolutePhotoUrl(photo.url) }
          })
        });
        const pinData = await pinRes.json();
        if (pinData.id) await env.DB.prepare(`UPDATE photos SET pinterest_pin_id_en=? WHERE id=?`).bind(pinData.id, photo.id).run();
      } catch {
      }
      await new Promise((r) => setTimeout(r, 600));
    }
  } catch {
  }
}
__name(runPinterestCronSync, "runPinterestCronSync");
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
