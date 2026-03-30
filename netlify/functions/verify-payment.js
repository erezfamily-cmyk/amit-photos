// Netlify Function — אימות תשלום PayPal דרך PDT
// מקבל tx (transaction ID) ו-item_number (fileId_size)
// מאמת מול PayPal ומחזיר URL להורדה מ-Google Drive

const https = require('https');
const querystring = require('querystring');

const SIZE_MAP = {
  small:  'w1500',
  medium: 'w3000',
  large:  null, // full download
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  const { tx, item_number } = event.queryStringParameters || {};
  const pdtToken = process.env.PAYPAL_PDT_TOKEN;

  if (!tx || !item_number) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'חסרים פרמטרים' }) };
  }

  if (!pdtToken) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'PDT לא מוגדר בשרת' }) };
  }

  // פענח fileId ו-size מ-item_number (פורמט: "fileId_size")
  const lastUnderscore = item_number.lastIndexOf('_');
  if (lastUnderscore === -1) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'item_number לא תקין' }) };
  }
  const fileId = item_number.substring(0, lastUnderscore);
  const size = item_number.substring(lastUnderscore + 1);

  if (!SIZE_MAP.hasOwnProperty(size)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'גודל לא תקין' }) };
  }

  // אמת מול PayPal PDT
  let paypalResponse;
  try {
    paypalResponse = await verifyWithPayPal(tx, pdtToken);
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'שגיאה בתקשורת עם PayPal' }) };
  }

  if (!paypalResponse.startsWith('SUCCESS')) {
    return { statusCode: 402, headers, body: JSON.stringify({ error: 'התשלום לא אומת' }) };
  }

  // פענח פרטי העסקה
  const txData = parsePayPalResponse(paypalResponse);
  const paymentStatus = txData['payment_status'];
  const receiverEmail = txData['receiver_email'];

  if (paymentStatus !== 'Completed') {
    return { statusCode: 402, headers, body: JSON.stringify({ error: `סטטוס תשלום: ${paymentStatus}` }) };
  }

  if (receiverEmail && receiverEmail.toLowerCase() !== 'erez.family@gmail.com') {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'נמען לא תקין' }) };
  }

  // בנה URL להורדה מ-Google Drive
  const sz = SIZE_MAP[size];
  const downloadUrl = sz
    ? `https://drive.google.com/thumbnail?id=${fileId}&sz=${sz}`
    : `https://drive.google.com/uc?export=download&id=${fileId}`;

  const title = txData['item_name'] || 'תמונה';

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ url: downloadUrl, title }),
  };
};

function verifyWithPayPal(tx, pdtToken) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({ cmd: '_notify-synch', tx, at: pdtToken });

    const req = https.request({
      hostname: 'www.paypal.com',
      path: '/cgi-bin/webscr',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function parsePayPalResponse(response) {
  const lines = response.split('\n');
  const result = {};
  // שורה ראשונה היא SUCCESS/FAIL
  for (let i = 1; i < lines.length; i++) {
    const [key, ...rest] = lines[i].split('=');
    if (key) result[decodeURIComponent(key)] = decodeURIComponent(rest.join('='));
  }
  return result;
}
