(function () {
  var STORAGE_KEY = 'cookie_notice_dismissed';
  try {
    if (localStorage.getItem(STORAGE_KEY) === '1') return;
  } catch (e) {}

  var isEn = (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0;
  function t(he, en) { return isEn ? en : he; }

  var style = document.createElement('style');
  style.textContent =
    '#cookie-notice{position:fixed;bottom:0;left:0;right:0;z-index:99997;' +
    'background:#111;border-top:1px solid #333;color:#f0ede8;font-family:Heebo,sans-serif;' +
    'padding:1rem 1.25rem;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;' +
    'gap:1rem;font-size:.85rem;box-shadow:0 -2px 12px rgba(0,0,0,.4)}' +
    '#cookie-notice a{color:#c8a96e}' +
    '#cookie-notice button{background:#c8a96e;color:#0a0a0a;border:none;border-radius:4px;' +
    'padding:.5rem 1.25rem;font-weight:700;cursor:pointer;font-size:.85rem;white-space:nowrap}' +
    '#cookie-notice button:hover{background:#e0c080}' +
    '#cookie-notice p{margin:0;max-width:640px;line-height:1.5}';
  document.head.appendChild(style);

  var bar = document.createElement('div');
  bar.id = 'cookie-notice';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', t('הודעת עוגיות', 'Cookie notice'));
  bar.innerHTML =
    '<p>' + t(
      'האתר משתמש בעוגיות אנליטיות (Google Analytics) כדי להבין כיצד הוא בשימוש. אין עוגיות שיווקיות. פרטים נוספים ב-',
      'This site uses analytics cookies (Google Analytics) to understand usage. No marketing cookies. See our '
    ) + '<a href="/privacy/">' + t('מדיניות הפרטיות', 'privacy policy') + '</a>.</p>' +
    '<button type="button" id="cookie-notice-ok">' + t('הבנתי', 'Got it') + '</button>';

  document.body.appendChild(bar);

  document.getElementById('cookie-notice-ok').addEventListener('click', function () {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) {}
    bar.remove();
  });
})();
