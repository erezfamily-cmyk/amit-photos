// Shared navigation — injected into all sub-pages
(function () {
  const isHome = window.location.pathname === '/' || window.location.pathname === '/index.html';

  // ── Nav translations (standalone, no dependency on i18n.js) ──────────────────
  const NAV_T = {
    he: {
      logoName: 'עמית ארז',
      logoTagline: ' | עולם של צבעים מבעד לעדשה',
      gallery: 'גלריה', navNew: 'חדש באתר', navSale: 'מבצע',
      challenges: 'אתגרים', camera: 'למד לצלם', learn: 'ניתוח תמונות',
      howToBuy: 'כיצד לרכוש', pricing: 'מחירים', contact: 'צור קשר', locations: 'מקומות לצילום',
      menu: 'תפריט'
    },
    en: {
      logoName: 'Amit Erez',
      logoTagline: ' | A World of Colors Through the Lens',
      gallery: 'Gallery', navNew: 'New', navSale: 'Sale',
      challenges: 'Challenges', camera: 'Learn Photography', learn: 'Photo School',
      howToBuy: 'How to Buy', pricing: 'Pricing', contact: 'Contact', locations: 'Locations',
      menu: 'Menu'
    }
  };

  let currentLang = (localStorage.getItem('lang') || 'he');

  function applyNavLang(lang) {
    currentLang = lang;
    const t = NAV_T[lang] || NAV_T.he;
    const nav = document.getElementById('main-nav');
    if (!nav) return;
    const q = function (sel) { return nav.querySelector(sel); };
    const logoName = q('[data-nav="logo.name"]');
    const logoTag  = q('[data-nav="logo.tagline"]');
    if (logoName) logoName.textContent = t.logoName;
    if (logoTag)  logoTag.textContent  = t.logoTagline;
    const map = {
      'nav.gallery': t.gallery, 'nav.new': t.navNew, 'nav.sale': t.navSale,
      'nav.challenges': t.challenges, 'nav.camera': t.camera, 'nav.learn': t.learn,
      'nav.how-to-buy': t.howToBuy, 'nav.pricing': t.pricing, 'nav.contact': t.contact,
      'nav.locations': t.locations
    };
    nav.querySelectorAll('[data-i18n]').forEach(function (el) {
      const key = el.dataset.i18n;
      if (map[key] !== undefined) el.textContent = map[key];
    });
    nav.querySelectorAll('.lang-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.lang === lang);
    });
    // sync with global setLang if available
    if (typeof setLang === 'function' && typeof window.__navLangApplying === 'undefined') {
      window.__navLangApplying = true;
      setLang(lang);
      delete window.__navLangApplying;
    }
  }

  function a(href) {
    return (!isHome && href.startsWith('#')) ? '/' + href : href;
  }

  // ── CSS ─────────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
:root {
  --bg-nav: rgba(10,10,10,0.95);
  --text-muted-nav: #888;
  --font-nav: 'Heebo', sans-serif;
  --font-display-nav: 'Syne', sans-serif;
}
body { padding-top: 64px !important; }
nav#main-nav {
  position: fixed; top: 0; left: 0; right: 0;
  z-index: 1000;
  background: var(--bg-nav, rgba(10,10,10,0.95));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid transparent;
  padding: 0 2.5rem;
  height: 64px;
  display: flex; align-items: center; justify-content: space-between;
  transition: border-color 0.3s;
  font-family: var(--font-nav, 'Heebo', sans-serif);
}
nav#main-nav.scrolled { border-bottom-color: rgba(200,169,110,0.3); }
nav#main-nav .nav-logo {
  font-family: var(--font-display-nav, 'Syne', sans-serif);
  font-size: 1.25rem; font-weight: 800; letter-spacing: -0.02em;
  color: var(--text, #f0ede8); text-decoration: none;
}
nav#main-nav .nav-logo .nav-logo-tagline {
  color: var(--accent, #c8a96e);
  font-family: var(--font-nav, 'Heebo', sans-serif);
  font-weight: 700; font-size: 0.8rem; letter-spacing: 0.03em;
}
nav#main-nav .nav-links {
  display: flex; gap: 2.5rem; list-style: none;
}
nav#main-nav .nav-links a {
  font-size: 0.85rem; color: var(--text-muted-nav, #888);
  transition: color 0.2s; letter-spacing: 0.05em;
  position: relative; text-decoration: none;
}
nav#main-nav .nav-links a#nav-new { color: #c8a96e !important; font-weight: 600; }
nav#main-nav .nav-links a#nav-sale { color: #34d399 !important; font-weight: 600; }
nav#main-nav .nav-links a::after {
  content: ''; position: absolute; bottom: -3px; right: 0;
  width: 0; height: 1px; background: var(--accent, #c8a96e);
  transition: width 0.25s ease;
}
nav#main-nav .nav-links a:hover::after,
nav#main-nav .nav-links a.active::after { width: 100%; }
nav#main-nav .nav-links a:hover,
nav#main-nav .nav-links a.active { color: var(--text, #f0ede8); }
nav#main-nav .lang-toggle {
  display: flex; align-items: center; gap: 0.2rem;
  font-size: 0.7rem; color: var(--text-muted-nav, #888);
  margin-inline-start: 0.5rem;
}
nav#main-nav .lang-btn {
  background: none; border: none; color: var(--text-muted-nav, #888);
  cursor: pointer; font-size: 0.7rem; padding: 0.15rem 0.25rem;
  font-family: inherit; letter-spacing: 0.05em; transition: color 0.2s;
}
nav#main-nav .lang-btn.active { color: var(--accent, #c8a96e); font-weight: 700; }
nav#main-nav .lang-btn:hover { color: var(--accent, #c8a96e); }
nav#main-nav .lang-sep { color: #333; }
nav#main-nav .nav-hamburger {
  display: none; flex-direction: column; gap: 5px;
  cursor: pointer; background: none; border: none; padding: 4px;
}
nav#main-nav .nav-hamburger span {
  display: block; width: 24px; height: 2px;
  background: var(--text, #f0ede8); transition: all 0.3s;
}
nav#main-nav .nav-hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
nav#main-nav .nav-hamburger.open span:nth-child(2) { opacity: 0; transform: scaleX(0); }
nav#main-nav .nav-hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }
@media (max-width: 768px) {
  nav#main-nav { padding: 0 1.25rem; }
  nav#main-nav .nav-links {
    position: fixed; top: 64px; left: 0; right: 0;
    background: var(--bg-nav, rgba(10,10,10,0.95));
    flex-direction: column; padding: 1.5rem 2rem; gap: 1.5rem;
    border-bottom: 1px solid var(--border, #222);
    display: none;
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
  }
  nav#main-nav .nav-links.open { display: flex; }
  nav#main-nav .nav-hamburger { display: flex; }
}
`;
  document.head.appendChild(style);

  // ── HTML ─────────────────────────────────────────────────────────────────────
  const nav = document.createElement('nav');
  nav.id = 'main-nav';
  nav.innerHTML = `
<a href="${isHome ? '#hero' : '/'}" class="nav-logo">
  <span data-nav="logo.name" data-i18n="nav.logo.name">עמית ארז</span><span class="nav-logo-tagline" data-nav="logo.tagline" data-i18n="nav.logo.tagline"> | עולם של צבעים מבעד לעדשה</span>
</a>
<ul class="nav-links">
  <li><a href="${a('#gallery')}" data-i18n="nav.gallery">גלריה</a></li>
  <li><a href="${a('#gallery')}" id="nav-new" data-i18n="nav.new">חדש באתר</a></li>
  <li><a href="${a('#gallery')}" id="nav-sale" data-i18n="nav.sale">מבצע</a></li>
  <li><a href="/games/" data-i18n="nav.challenges">אתגרים</a></li>
  <li><a href="/camera/" data-i18n="nav.camera">למד לצלם</a></li>
  <li><a href="/locations/" data-i18n="nav.locations">מקומות לצילום</a></li>
  <li><a href="/learn/" data-i18n="nav.learn">ניתוח תמונות</a></li>
  <li><a href="${a('#how-to-buy')}" data-i18n="nav.how-to-buy">כיצד לרכוש</a></li>
  <li><a href="${a('#pricing')}" data-i18n="nav.pricing">מחירים</a></li>
  <li><a href="${a('#contact')}" data-i18n="nav.contact">צור קשר</a></li>
</ul>
<div class="lang-toggle">
  <button type="button" class="lang-btn active" data-lang="he" aria-label="עברית">HE</button>
  <span class="lang-sep">|</span>
  <button type="button" class="lang-btn" data-lang="en" aria-label="English">EN</button>
</div>
<button class="nav-hamburger" aria-label="תפריט">
  <span></span><span></span><span></span>
</button>
`;
  document.body.insertBefore(nav, document.body.firstChild);

  // ── Hamburger ─────────────────────────────────────────────────────────────────
  const hamburger = nav.querySelector('.nav-hamburger');
  const links = nav.querySelector('.nav-links');
  hamburger.addEventListener('click', function () {
    this.classList.toggle('open');
    links.classList.toggle('open');
  });

  // close mobile menu on link click
  links.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') {
      hamburger.classList.remove('open');
      links.classList.remove('open');
    }
  });

  // ── Scroll border ──────────────────────────────────────────────────────────────
  window.addEventListener('scroll', function () {
    nav.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });

  // ── Active link ────────────────────────────────────────────────────────────────
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  nav.querySelectorAll('.nav-links a').forEach(function (a) {
    const href = (a.getAttribute('href') || '').replace(/\/$/, '');
    if (!href || href.startsWith('#') || href.startsWith('/#')) return;
    if (href === path || (href !== '/' && path.startsWith(href))) {
      a.classList.add('active');
    }
  });

  // ── Lang toggle ────────────────────────────────────────────────────────────────
  nav.querySelectorAll('.lang-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      applyNavLang(this.dataset.lang);
    });
  });

  // ── i18n sync ───────────────────────────────────────────────────────────────
  // If i18n.js is present, let it drive the nav too; otherwise nav handles itself
  if (typeof applyTranslations === 'function') {
    applyTranslations();
  } else {
    applyNavLang(currentLang);
  }

  // Expose so external code (e.g. i18n.js setLang) can re-translate the nav
  window.applyNavLang = applyNavLang;

  // ── Footer ────────────────────────────────────────────────────────────────────
  const footerStyle = document.createElement('style');
  footerStyle.textContent = `
footer#main-footer {
  text-align: center; padding: 1.5rem 1.25rem;
  border-top: 1px solid #222; margin-top: 2rem;
  font-family: 'Heebo', sans-serif; font-size: 0.78rem; color: #555;
}
footer#main-footer a { color: #888; text-decoration: none; transition: color 0.2s; }
footer#main-footer a:hover { color: #c8a96e; }
`;
  document.head.appendChild(footerStyle);

  const footer = document.createElement('footer');
  footer.id = 'main-footer';
  const privacyHe = 'מדיניות פרטיות';
  const privacyEn = 'Privacy Policy';
  footer.innerHTML = `<a href="/privacy/" id="footer-privacy">${currentLang === 'en' ? privacyEn : privacyHe}</a>`;
  document.body.appendChild(footer);

  const origApplyNavLang = applyNavLang;
  applyNavLang = function(lang) {
    origApplyNavLang(lang);
    const fp = document.getElementById('footer-privacy');
    if (fp) fp.textContent = lang === 'en' ? privacyEn : privacyHe;
  };
  window.applyNavLang = applyNavLang;
})();
