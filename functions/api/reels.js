// POST /api/reels              — מפעיל GitHub Actions workflow
// GET  /api/reels?run_id=...   — בודק סטטוס ריצה
// GET  /api/reels?latest=1     — מחזיר run_id האחרון

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'X-Admin-Password,Content-Type',
};

const GH_OWNER    = 'erezfamily-cmyk';
const GH_REPO     = 'amit-photos';
const WORKFLOW_ID = 'reel-maker.yml';

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

// POST — מפעיל workflow ומחזיר אישור
export async function onRequestPost({ request, env }) {
  try {
    const pwd = request.headers.get('X-Admin-Password') || '';
    if (pwd !== env.ADMIN_PASSWORD) return unauth();

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'גוף הבקשה שגוי' }), { status: 400, headers: HEADERS });
    }

    const { category, lang = 'auto' } = body;
    if (!category) {
      return new Response(JSON.stringify({ error: 'category חסר' }), { status: 400, headers: HEADERS });
    }

    const ghRes = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`,
      {
        method: 'POST',
        headers: ghHeaders(env.GITHUB_TOKEN),
        body: JSON.stringify({ ref: 'main', inputs: { category, lang } }),
      }
    );

    if (!ghRes.ok) {
      const err = await ghRes.text();
      return new Response(
        JSON.stringify({ error: `GitHub שגיאה (${ghRes.status}): ${err.slice(0, 200)}` }),
        { status: 502, headers: HEADERS }
      );
    }

    // dispatch מחזיר 204 — נסמן הצלחה, run_id יתקבל דרך GET?latest=1
    return new Response(JSON.stringify({ ok: true }), { headers: HEADERS });

  } catch (e) {
    return new Response(JSON.stringify({ error: `שגיאה פנימית: ${e.message}` }), { status: 500, headers: HEADERS });
  }
}

// GET — סטטוס ריצה או run_id אחרון
export async function onRequestGet({ request, env }) {
  try {
    const pwd = request.headers.get('X-Admin-Password') || '';
    if (pwd !== env.ADMIN_PASSWORD) return unauth();

    const url    = new URL(request.url);
    const runId  = url.searchParams.get('run_id');
    const latest = url.searchParams.get('latest');

    // מחזיר run_id של הריצה האחרונה
    if (latest) {
      const res  = await fetch(
        `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${WORKFLOW_ID}/runs?per_page=1`,
        { headers: ghHeaders(env.GITHUB_TOKEN) }
      );
      const data = await res.json();
      const run  = data.workflow_runs?.[0];
      return new Response(
        JSON.stringify({ run_id: run?.id, status: run?.status }),
        { headers: HEADERS }
      );
    }

    // בודק סטטוס לפי run_id
    if (!runId) {
      return new Response(JSON.stringify({ error: 'run_id או latest חסר' }), { status: 400, headers: HEADERS });
    }

    const res = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}`,
      { headers: ghHeaders(env.GITHUB_TOKEN) }
    );
    const run = await res.json();

    let artifact_url = null;
    if (run.status === 'completed' && run.conclusion === 'success') {
      artifact_url = `https://github.com/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}`;
    }

    return new Response(JSON.stringify({
      status:       run.status,
      conclusion:   run.conclusion,
      run_url:      run.html_url,
      artifact_url,
    }), { headers: HEADERS });

  } catch (e) {
    return new Response(JSON.stringify({ error: `שגיאה פנימית: ${e.message}` }), { status: 500, headers: HEADERS });
  }
}
