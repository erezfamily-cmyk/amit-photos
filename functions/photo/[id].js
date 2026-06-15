// GET /photo/[id] — עמוד שיתוף עם OG tags דינמיות לכל תמונה.
// בוטים (WhatsApp, Facebook, Pinterest) מקבלים OG ספציפי לתמונה;
// דפדפנים רגילים מופנים מיד לגלריה עם ה-lightbox פתוח.

export async function onRequestGet({ params, env }) {
  const id = params.id;
  if (!id) return Response.redirect('/', 302);

  const photo = await env.DB.prepare(
    'SELECT id, title, category, description, url, thumbnail, width, height FROM photos WHERE id = ?'
  ).bind(id).first();

  if (!photo) return Response.redirect('/', 302);

  const siteUrl = 'https://amitphotos.com';
  const pageUrl = `${siteUrl}/photo/${photo.id}`;
  const imgUrl  = photo.thumbnail || photo.url;
  const title   = `${photo.title} | עמית ארז`;
  const desc    = photo.description
    ? photo.description
    : `צילום אמנותי — ${photo.category} | עמית ארז`;

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${h(title)}</title>
  <meta name="description" content="${h(desc)}" />
  <meta property="og:title"       content="${h(title)}" />
  <meta property="og:description" content="${h(desc)}" />
  <meta property="og:image"       content="${h(imgUrl)}" />
  <meta property="og:url"         content="${h(pageUrl)}" />
  <meta property="og:type"        content="article" />
  <meta property="og:locale"      content="he_IL" />
  ${photo.width  ? `<meta property="og:image:width"  content="${photo.width}" />` : ''}
  ${photo.height ? `<meta property="og:image:height" content="${photo.height}" />` : ''}
  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:title"       content="${h(title)}" />
  <meta name="twitter:description" content="${h(desc)}" />
  <meta name="twitter:image"       content="${h(imgUrl)}" />
  <meta http-equiv="refresh" content="0; url=/#photo-${h(photo.id)}" />
  <script>window.location.replace('/#photo-${js(photo.id)}');</script>
</head>
<body></body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

function h(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function js(s) {
  return String(s).replace(/['"\\]/g, c => '\\' + c);
}
