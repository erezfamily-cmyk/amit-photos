// GET /video/{key} — stream video from R2 with range support

export async function onRequestGet({ params, env, request }) {
  const key = decodeURIComponent(params.key);
  if (!key) return new Response('Not found', { status: 404 });

  const r2Key = `video/${key}`;
  const rangeHeader = request.headers.get('Range');

  if (rangeHeader) {
    const object = await env.PHOTOS.get(r2Key, { range: rangeHeader });
    if (!object) return new Response('Not found', { status: 404 });

    const { offset = 0, length = object.size } = object.range ?? {};
    const total = object.size;

    return new Response(object.body, {
      status: 206,
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'video/mp4',
        'Content-Range': `bytes ${offset}-${offset + length - 1}/${total}`,
        'Content-Length': String(length),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }

  const object = await env.PHOTOS.get(r2Key);
  if (!object) return new Response('Not found', { status: 404 });

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'video/mp4',
      'Content-Length': String(object.size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
