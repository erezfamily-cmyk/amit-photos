// Netlify Function — triggers photo-breakdown.yml workflow on GitHub
// Env vars needed in Netlify Dashboard:
//   ADMIN_PASSWORD — same as site admin password
//   GH_PAT        — GitHub Personal Access Token with repo + workflow scopes

const OWNER = 'erezfamily-cmyk';
const REPO  = 'amit-photos';

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const adminPwd  = process.env.ADMIN_PASSWORD;
  const ghPat     = process.env.GH_PAT;

  if (!adminPwd || !ghPat) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  const reqPwd = event.headers['x-admin-password'] || '';
  if (!reqPwd || reqPwd !== adminPwd) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
  const { photo_id } = body;

  if (!photo_id) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing photo_id' }) };
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/photo-breakdown.yml/dispatches`,
      {
        method:  'POST',
        headers: {
          Authorization: `token ${ghPat}`,
          Accept:        'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent':   'amitphotos-admin/1.0',
        },
        body: JSON.stringify({ ref: 'main', inputs: { photo_id } }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return { statusCode: res.status, headers: cors, body: JSON.stringify({ error: `GitHub: ${text.slice(0, 200)}` }) };
    }

    // Get latest run after short delay (caller should poll)
    return {
      statusCode: 200,
      headers:    cors,
      body:       JSON.stringify({
        ok:      true,
        actions: `https://github.com/${OWNER}/${REPO}/actions/workflows/photo-breakdown.yml`,
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
