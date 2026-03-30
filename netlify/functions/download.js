// Netlify Function — הגנת סיסמה על הורדת תמונות
// הסיסמה מוגדרת במשתנה סביבה DOWNLOAD_PASSWORD ב-Netlify Dashboard

exports.handler = async (event) => {
  const { password, fileId } = JSON.parse(event.body || '{}');
  const correctPassword = process.env.DOWNLOAD_PASSWORD;

  if (!correctPassword) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Password not configured' }) };
  }

  if (!password || password !== correctPassword) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'סיסמה שגויה' }),
    };
  }

  if (!fileId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing fileId' }) };
  }

  // מחזיר URL להורדה מ-Google Drive
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  return {
    statusCode: 200,
    body: JSON.stringify({ url: downloadUrl }),
  };
};
