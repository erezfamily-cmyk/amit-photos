// GET /photos/{key} — הגשת תמונות מ-R2

export async function onRequestGet({ params, env }) {
  const key = params.key;
  if (!key) return new Response('Not found', { status: 404 });

  const object = await env.PHOTOS.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': object.httpEtag,
    },
  });
}
