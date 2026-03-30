// Cloudflare Pages Function — הגנת סיסמה על הורדת תמונות
// POST /functions/download

export async function onRequestPost({ request, env }) {
  const headers = { 'Content-Type': 'application/json' };
  const { password, fileId } = await request.json().catch(() => ({}));
  const correctPassword = env.DOWNLOAD_PASSWORD;

  if (!correctPassword) {
    return new Response(JSON.stringify({ error: 'Password not configured' }), { status: 500, headers });
  }
  if (!password || password !== correctPassword) {
    return new Response(JSON.stringify({ error: 'סיסמה שגויה' }), { status: 401, headers });
  }
  if (!fileId) {
    return new Response(JSON.stringify({ error: 'Missing fileId' }), { status: 400, headers });
  }

  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  return new Response(JSON.stringify({ url: downloadUrl }), { status: 200, headers });
}
