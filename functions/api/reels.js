// POST /api/reels         — מפעיל GitHub Actions workflow ליצירת רילס
// GET  /api/reels?run_id= — בודק סטטוס ריצה

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

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: HEADERS });
}

// POST — מפעיל workflow
export async function onRequestPost({ request, env }) {
  if (request.headers.get('X-Admin-Password') !== env.ADMIN_PASSWORD) return unauth();

  const { category, lang = 'auto' } = await request.json();
  if (!category) {
    return new Response(JSON.stringify({ error: 'category חסר' }), { status: 400, headers: HEADERS });
  }

  const ghRes = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main', inputs: { category, lang } }),
    }
  );

  if (!ghRes.ok) {
    const err = await ghRes.text();
    return new Response(JSON.stringify({ error: `GitHub: ${err}` }), { status: 502, headers: HEADERS });
  }

  // המתן שניה וקבל run_id
  await new Promise(r => setTimeout(r, 3000));

  const runsRes = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${WORKFLOW_ID}/runs?per_page=1`,
    { headers: { 'Authorization': `Bearer ${env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github+json' } }
  );
  const runs  = await runsRes.json();
  const runId = runs.workflow_runs?.[0]?.id;

  return new Response(JSON.stringify({ ok: true, run_id: runId }), { headers: HEADERS });
}

// GET — בודק סטטוס + artifact
export async function onRequestGet({ request, env }) {
  if (request.headers.get('X-Admin-Password') !== env.ADMIN_PASSWORD) return unauth();

  const runId = new URL(request.url).searchParams.get('run_id');
  if (!runId) return new Response(JSON.stringify({ error: 'run_id חסר' }), { status: 400, headers: HEADERS });

  const runRes = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}`,
    { headers: { 'Authorization': `Bearer ${env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github+json' } }
  );
  const run = await runRes.json();

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
}
