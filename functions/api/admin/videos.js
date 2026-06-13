// GET  /api/admin/videos — list videos from R2
// POST /api/admin/videos (multipart) — upload video to R2
// POST /api/admin/videos (json {key}) — trigger distribute workflow

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'X-Session-Token,Content-Type',
};

const GH_OWNER    = 'erezfamily-cmyk';
const GH_REPO     = 'amit-photos';
const WORKFLOW_ID = 'distribute-video.yml';
const SITE_ORIGIN = 'https://amitphotos.com';

function unauth() {
  return new Response(JSON.stringify({ error: 'לא מורשה' }), { status: 401, headers: HEADERS });
}

function ghHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'amitphotos-worker',
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: HEADERS });
}

export async function onRequestGet({ request, env }) {
  const token = request.headers.get('X-Session-Token') || '';
  if (token !== env.ADMIN_PASSWORD) return unauth();

  const list = await env.PHOTOS.list({ prefix: 'video/' });

  // Load distributed_videos.json from GitHub to check posted status
  let posted = {};
  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/distributed_videos.json`,
      { headers: ghHeaders(env.GH_TOKEN) }
    );
    if (ghRes.ok) {
      const ghData = await ghRes.json();
      const records = JSON.parse(atob(ghData.content.replace(/\n/g, '')));
      for (const v of records) posted[v.filename] = v;
    }
  } catch { /* ignore */ }

  const videos = list.objects
    .map(obj => {
      const key = obj.key.replace('video/', ''); // e.g. uuid-name.mp4
      const postData = posted[key] || null;
      return {
        key,
        name: obj.customMetadata?.originalName || key,
        size: obj.size,
        uploaded: obj.uploaded,
        posted: !!postData,
        date: postData?.date || null,
        platforms: postData?.platforms || null,
      };
    })
    .sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));

  return new Response(JSON.stringify({ ok: true, videos }), { headers: HEADERS });
}

export async function onRequestPost({ request, env }) {
  const token = request.headers.get('X-Session-Token') || '';
  if (token !== env.ADMIN_PASSWORD) return unauth();

  const contentType = request.headers.get('Content-Type') || '';

  // ── Upload ───────────────────────────────────────────────────────────────
  if (contentType.includes('multipart/form-data')) {
    let formData;
    try { formData = await request.formData(); } catch {
      return new Response(JSON.stringify({ error: 'שגיאה בקריאת הקובץ' }), { status: 400, headers: HEADERS });
    }

    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return new Response(JSON.stringify({ error: 'קובץ חסר' }), { status: 400, headers: HEADERS });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uuid = crypto.randomUUID().split('-')[0]; // short id
    const key = `${uuid}-${safeName}`;

    await env.PHOTOS.put(`video/${key}`, file.stream(), {
      httpMetadata: { contentType: file.type || 'video/mp4' },
      customMetadata: { originalName: file.name },
    });

    return new Response(JSON.stringify({ ok: true, key, filename: file.name }), { headers: HEADERS });
  }

  // ── Distribute ────────────────────────────────────────────────────────────
  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'גוף הבקשה שגוי' }), { status: 400, headers: HEADERS });
  }

  const { key } = body;
  if (!key) return new Response(JSON.stringify({ error: 'key חסר' }), { status: 400, headers: HEADERS });

  const videoUrl = `${SITE_ORIGIN}/video/${key}`;

  const ghRes = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`,
    {
      method: 'POST',
      headers: ghHeaders(env.GH_TOKEN),
      body: JSON.stringify({ ref: 'main', inputs: { video_url: videoUrl } }),
    }
  );

  if (!ghRes.ok) {
    const err = await ghRes.text();
    return new Response(JSON.stringify({ ok: false, error: err }), { status: 502, headers: HEADERS });
  }

  return new Response(JSON.stringify({ ok: true, url: videoUrl }), { headers: HEADERS });
}
