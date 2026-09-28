// Anonymous UX measurement for design decisions. Never send form values or other PII.
(() => {
  const GA_MEASUREMENT_ID = 'G-XM6T3E8QWN';
  const ALLOWED_PARAMS = new Set([
    'source', 'label', 'destination', 'method', 'filter', 'language',
    'from_language', 'to_language', 'depth', 'photo_id', 'result_count',
  ]);
  const sentScrollDepths = new Set();
  const SCROLL_DEPTHS = [25, 50, 75, 90];

  function ensureGoogleAnalytics() {
    if (typeof window.gtag === 'function') return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID, { send_page_view: true });

    if (!document.querySelector?.(`script[src*="googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"]`)) {
      const script = document.createElement?.('script');
      if (script) {
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
        document.head?.appendChild(script);
      }
    }
  }

  ensureGoogleAnalytics();

  function trackUxEvent(name, params = {}) {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(name) || typeof window.gtag !== 'function') return;

    const safeParams = { page_path: window.location?.pathname || '/' };
    Object.entries(params).forEach(([key, value]) => {
      if (!ALLOWED_PARAMS.has(key)) return;
      if (!['string', 'number', 'boolean'].includes(typeof value)) return;
      safeParams[key] = typeof value === 'string' ? value.slice(0, 100) : value;
    });
    window.gtag('event', name, safeParams);
  }

  function initDeclarativeTracking() {
    document.addEventListener('click', event => {
      const target = event.target.closest?.('[data-analytics-event]');
      if (target) {
        const eventName = target.dataset.analyticsEvent;
        trackUxEvent(eventName, {
          label: target.dataset.analyticsLabel || '',
          destination: target.dataset.analyticsMethod ? '' : target.getAttribute('href') || '',
          method: target.dataset.analyticsMethod || '',
          photo_id: target.dataset.analyticsPhotoId || '',
        });
        const navLabel = target.dataset.analyticsLabel || '';
        if (eventName === 'nav_click' && /^[a-z][a-z0-9_]{1,24}$/.test(navLabel)) {
          trackUxEvent(`nav_${navLabel}_click`, { destination: target.getAttribute('href') || '' });
        }
        return;
      }

      const link = event.target.closest?.('a[href]');
      const href = link?.getAttribute('href') || '';
      const method = href.startsWith('tel:') ? 'phone'
        : href.startsWith('mailto:') ? 'email'
        : /(?:wa\.me|whatsapp\.com)/i.test(href) ? 'whatsapp'
        : '';
      if (method) {
        trackUxEvent('contact_intent', { method });
      } else if (link && href && !href.startsWith('#') && !/^(?:https?:)?\/\//i.test(href)) {
        trackUxEvent('content_link_click', { destination: href });
      }
    });

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        const depth = Math.min(100, Math.round((window.scrollY / scrollable) * 100));
        SCROLL_DEPTHS.forEach(milestone => {
          if (depth >= milestone && !sentScrollDepths.has(milestone)) {
            sentScrollDepths.add(milestone);
            trackUxEvent(`scroll_${milestone}`, { depth: milestone });
          }
        });
        ticking = false;
      });
    }, { passive: true });
  }

  window.trackUxEvent = trackUxEvent;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDeclarativeTracking, { once: true });
  } else {
    initDeclarativeTracking();
  }
})();
