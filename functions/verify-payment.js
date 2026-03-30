// Cloudflare Pages Function — אימות תשלום PayPal PDT
// GET /functions/verify-payment?tx=...&item_number=...

export async function onRequestGet({ request, env }) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  const url = new URL(request.url);
  const tx = url.searchParams.get('tx');
  const itemNumber = url.searchParams.get('item_number');
  const pdtToken = env.PAYPAL_PDT_TOKEN;

  if (!tx || !itemNumber) {
    return new Response(JSON.stringify({ error: 'חסרים פרמטרים' }), { status: 400, headers });
  }
  if (!pdtToken) {
    return new Response(JSON.stringify({ error: 'PDT לא מוגדר' }), { status: 500, headers });
  }

  const lastUnderscore = itemNumber.lastIndexOf('_');
  if (lastUnderscore === -1) {
    return new Response(JSON.stringify({ error: 'item_number לא תקין' }), { status: 400, headers });
  }
  const fileId = itemNumber.substring(0, lastUnderscore);
  const size = itemNumber.substring(lastUnderscore + 1);

  const SIZE_MAP = { small: 'w1500', medium: 'w3000', large: null };
  if (!Object.prototype.hasOwnProperty.call(SIZE_MAP, size)) {
    return new Response(JSON.stringify({ error: 'גודל לא תקין' }), { status: 400, headers });
  }

  // אמת מול PayPal PDT
  const body = new URLSearchParams({ cmd: '_notify-synch', tx, at: pdtToken });
  let paypalText;
  try {
    const res = await fetch('https://www.paypal.com/cgi-bin/webscr', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    paypalText = await res.text();
  } catch {
    return new Response(JSON.stringify({ error: 'שגיאה בתקשורת עם PayPal' }), { status: 502, headers });
  }

  if (!paypalText.startsWith('SUCCESS')) {
    return new Response(JSON.stringify({ error: 'התשלום לא אומת' }), { status: 402, headers });
  }

  const txData = parsePayPalResponse(paypalText);
  if (txData['payment_status'] !== 'Completed') {
    return new Response(JSON.stringify({ error: `סטטוס: ${txData['payment_status']}` }), { status: 402, headers });
  }

  const sz = SIZE_MAP[size];
  const downloadUrl = sz
    ? `https://drive.google.com/thumbnail?id=${fileId}&sz=${sz}`
    : `https://drive.google.com/uc?export=download&id=${fileId}`;

  return new Response(JSON.stringify({ url: downloadUrl, title: txData['item_name'] || 'תמונה' }), { status: 200, headers });
}

function parsePayPalResponse(response) {
  const lines = response.split('\n');
  const result = {};
  for (let i = 1; i < lines.length; i++) {
    const eq = lines[i].indexOf('=');
    if (eq !== -1) {
      const key = decodeURIComponent(lines[i].substring(0, eq));
      const val = decodeURIComponent(lines[i].substring(eq + 1));
      result[key] = val;
    }
  }
  return result;
}
