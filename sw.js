const CACHE = 'amit-photos-v5';
const STATIC = [
  '/',
  '/index.html',
  '/assets/css/style.css',
  '/assets/js/gallery.js',
  '/assets/js/i18n.js',
  '/data/photos.json',
  '/404.html',
];

// עמוד/API שיכולים להשתנות בכל רגע (D1 דרך admin, ייבוא תמונות וכו') — תמיד רשת קודם.
// תמונות/JS/CSS סטטיים ממשיכים cache-first.
function shouldUseNetworkFirst(pathname) {
  return pathname.includes('photos.json') || pathname.startsWith('/api/');
}

// isomorphic export — self.addEventListener למטה רץ רק בסביבת Service Worker אמיתית;
// module.exports מאפשר לבדוק את shouldUseNetworkFirst ב-node:test בלי סביבת SW.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { shouldUseNetworkFirst };
}

// כל מה שמתחת רץ רק בסביבת Service Worker אמיתית (יש self/caches גלובליים) —
// כשהקובץ נטען דרך require() בטסט node:test, החלק הזה פשוט לא מופעל.
if (typeof self !== 'undefined') {
  // Install — cache static assets
  self.addEventListener('install', e => {
    e.waitUntil(
      caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
    );
  });

  // Activate — remove old caches
  self.addEventListener('activate', e => {
    e.waitUntil(
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
      ).then(() => self.clients.claim())
    );
  });

  // Fetch — network-first for anything dynamic (/api/*, photos.json, navigations), cache-first for static assets
  self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // Skip non-GET and cross-origin (Google Drive images)
    if (e.request.method !== 'GET' || !url.origin.includes(self.location.origin)) return;

    // Network-first: תמיד עדכני, נופל לקאש רק אם הרשת נכשלת
    if (shouldUseNetworkFirst(url.pathname) || e.request.mode === 'navigate') {
      e.respondWith(
        fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        }).catch(() => caches.match(e.request))
      );
      return;
    }

    // Cache-first for everything else (JS/CSS/images סטטיים)
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })).catch(() => caches.match('/404.html'))
    );
  });
}
