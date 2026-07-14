(function () {
  if (document.getElementById('a11y-widget-btn')) return;

  var STORAGE_KEY = 'a11y_prefs';
  var prefs = { fontStep: 0, contrast: false, noAnim: false };
  try {
    var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    prefs = Object.assign(prefs, saved);
  } catch (e) {}

  var isEn = (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0;
  function t(he, en) { return isEn ? en : he; }

  var style = document.createElement('style');
  style.textContent =
    '#a11y-widget-btn{position:fixed;bottom:1.25rem;inset-inline-start:1.25rem;z-index:99998;' +
    'width:44px;height:44px;border-radius:50%;background:#c8a96e;color:#0a0a0a;border:none;' +
    'cursor:pointer;font-size:1.3rem;display:flex;align-items:center;justify-content:center;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.35)}' +
    '#a11y-widget-btn:hover{background:#e0c080}' +
    '#a11y-widget-panel{position:fixed;bottom:4.5rem;inset-inline-start:1.25rem;z-index:99999;' +
    'background:#111;border:1px solid #333;border-radius:8px;padding:1rem;min-width:220px;' +
    'font-family:Heebo,sans-serif;color:#f0ede8;box-shadow:0 4px 20px rgba(0,0,0,.5);display:none}' +
    '#a11y-widget-panel.open{display:block}' +
    '#a11y-widget-panel h2{font-size:.9rem;margin:0 0 .75rem;color:#c8a96e;font-family:Syne,sans-serif}' +
    '.a11y-row{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.6rem;font-size:.85rem}' +
    '.a11y-row button{background:#222;border:1px solid #444;color:#f0ede8;border-radius:4px;' +
    'width:28px;height:28px;cursor:pointer;font-size:1rem}' +
    '.a11y-row button:hover{border-color:#c8a96e}' +
    '.a11y-toggle{background:#222;border:1px solid #444;color:#f0ede8;border-radius:4px;' +
    'padding:.3rem .7rem;cursor:pointer;font-size:.8rem}' +
    '.a11y-toggle[aria-pressed="true"]{background:#c8a96e;color:#0a0a0a;border-color:#c8a96e}' +
    'html.a11y-contrast body{filter:contrast(1.3) saturate(1.1)}' +
    'html.a11y-contrast{background:#000}' +
    'html.a11y-no-anim *,html.a11y-no-anim *::before,html.a11y-no-anim *::after{' +
    'animation-duration:.001ms!important;animation-iteration-count:1!important;' +
    'transition-duration:.001ms!important;scroll-behavior:auto!important}';
  document.head.appendChild(style);

  var btn = document.createElement('button');
  btn.id = 'a11y-widget-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', t('תפריט נגישות', 'Accessibility menu'));
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '♿';

  var panel = document.createElement('div');
  panel.id = 'a11y-widget-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('אפשרויות נגישות', 'Accessibility options'));
  panel.innerHTML =
    '<h2>' + t('נגישות', 'Accessibility') + '</h2>' +
    '<div class="a11y-row"><span>' + t('גודל טקסט', 'Text size') + '</span>' +
    '<span><button type="button" id="a11y-font-dec" aria-label="' + t('הקטן טקסט', 'Decrease text size') + '">A-</button> ' +
    '<button type="button" id="a11y-font-inc" aria-label="' + t('הגדל טקסט', 'Increase text size') + '">A+</button></span></div>' +
    '<div class="a11y-row"><span>' + t('ניגודיות גבוהה', 'High contrast') + '</span>' +
    '<button type="button" class="a11y-toggle" id="a11y-contrast-toggle" aria-pressed="false">' + t('הפעל', 'On') + '</button></div>' +
    '<div class="a11y-row"><span>' + t('עצירת אנימציות', 'Stop animations') + '</span>' +
    '<button type="button" class="a11y-toggle" id="a11y-anim-toggle" aria-pressed="false">' + t('הפעל', 'On') + '</button></div>' +
    '<div class="a11y-row"><a href="/accessibility/" style="color:#c8a96e">' + t('הצהרת נגישות מלאה ←', 'Full accessibility statement →') + '</a></div>';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  function apply() {
    document.documentElement.style.fontSize = (100 + prefs.fontStep * 10) + '%';
    document.documentElement.classList.toggle('a11y-contrast', prefs.contrast);
    document.documentElement.classList.toggle('a11y-no-anim', prefs.noAnim);
    document.getElementById('a11y-contrast-toggle').setAttribute('aria-pressed', String(prefs.contrast));
    document.getElementById('a11y-anim-toggle').setAttribute('aria-pressed', String(prefs.noAnim));
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  btn.addEventListener('click', function () {
    var open = panel.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });

  document.getElementById('a11y-font-inc').addEventListener('click', function () {
    prefs.fontStep = Math.min(prefs.fontStep + 1, 5);
    apply(); save();
  });
  document.getElementById('a11y-font-dec').addEventListener('click', function () {
    prefs.fontStep = Math.max(prefs.fontStep - 1, -3);
    apply(); save();
  });
  document.getElementById('a11y-contrast-toggle').addEventListener('click', function () {
    prefs.contrast = !prefs.contrast;
    apply(); save();
  });
  document.getElementById('a11y-anim-toggle').addEventListener('click', function () {
    prefs.noAnim = !prefs.noAnim;
    apply(); save();
  });

  document.addEventListener('click', function (e) {
    if (!panel.contains(e.target) && e.target !== btn && panel.classList.contains('open')) {
      panel.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });

  apply();
})();
