const STORAGE_KEY = 'amit-digital-checkout-v1';
const MAX_AGE = 24 * 60 * 60 * 1000;

// The page language must survive the PayPal round trip. An explicit ?lang wins,
// then the language saved with this tab's pending attempt, then the site preference.
export function resolveCheckoutLang({ param = null, pending = null, stored = null } = {}) {
  if (param === 'en' || param === 'he') return param;
  if (pending?.lang === 'en' || pending?.lang === 'he') return pending.lang;
  return stored === 'en' ? 'en' : 'he';
}

const APPROVAL_HOSTS = { sandbox: 'www.sandbox.paypal.com', live: 'www.paypal.com' };

export function createCheckoutClient({ fetcher = fetch, storage = sessionStorage, now = Date.now, uuid = () => crypto.randomUUID() } = {}) {
  let busy = false;
  let declinedOrder = null;
  const read = () => {
    try {
      const value = JSON.parse(storage.getItem(STORAGE_KEY));
      return value && now() - value.createdAt >= 0 && now() - value.createdAt < MAX_AGE ? value : null;
    } catch { return null; }
  };
  const save = value => storage.setItem(STORAGE_KEY, JSON.stringify(value));
  async function json(url, options) {
    const response = await fetcher(url, { cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'REQUEST_FAILED');
    return data;
  }
  return {
    pending: read,
    async quote(photoId) {
      return json('/api/paypal/quote?' + new URLSearchParams({ photoId, sku: 'large' }));
    },
    async start(quote, accepted, lang = 'he') {
      if (busy) throw new Error('BUSY');
      const language = lang === 'en' ? 'en' : 'he';
      if (!accepted || quote.enabled !== true || quote.currency !== 'ILS' || quote.license !== 'personal') throw new Error('CHECKOUT_DISABLED');
      busy = true;
      try {
        let attempt = read();
        if (!attempt || attempt.photoId !== quote.photoId || attempt.amountMinor !== quote.amountMinor) {
          attempt = { photoId: quote.photoId, amountMinor: quote.amountMinor, key: uuid(), createdAt: now(), lang: language };
          // Persist before the request: retries after a lost response use the same key.
          save(attempt);
        } else if (attempt.lang !== language) {
          attempt = { ...attempt, lang: language };
          save(attempt);
        }
        const data = await json('/api/paypal/create-order', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.key },
          body: JSON.stringify({ type: 'digital', photoId: quote.photoId, sku: 'large', currency: 'ILS', licenseAccepted: true, expectedAmountMinor: quote.amountMinor, lang: language }),
        });
        const approval = new URL(data.approveUrl);
        if (approval.protocol !== 'https:' || approval.hostname !== APPROVAL_HOSTS[quote.environment] || approval.username || approval.password ||
            !/^[A-Za-z0-9_-]{8,64}$/.test(data.paypalOrderId)) throw new Error('INVALID_APPROVAL');
        save({ ...attempt, paypalOrderId: data.paypalOrderId });
        return approval.href;
      } finally { busy = false; }
    },
    async capture(returnedToken) {
      if (busy) throw new Error('BUSY');
      const attempt = read();
      if (!attempt?.paypalOrderId || returnedToken !== attempt.paypalOrderId) throw new Error('RETURN_MISMATCH');
      declinedOrder = null;
      busy = true;
      try {
        let result;
        try {
          result = await json('/api/paypal/capture-order', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paypalOrderId: attempt.paypalOrderId }),
          });
        } catch (error) {
          if (error.message === 'PAYMENT_DECLINED') declinedOrder = attempt.paypalOrderId;
          throw error;
        }
        if (!/^\/api\/download\/[A-Za-z0-9_-]+$/.test(result.url)) throw new Error('INVALID_DOWNLOAD');
        return result; // Keep the order ID for safe recovery; never store the bearer download URL.
      } finally { busy = false; }
    },
    restartAfterDecline() {
      const attempt = read();
      if (busy || !declinedOrder || attempt?.paypalOrderId !== declinedOrder) throw new Error('RESTART_NOT_ALLOWED');
      storage.removeItem(STORAGE_KEY);
      declinedOrder = null;
      return attempt.photoId;
    },
  };
}

async function mount() {
  const params = new URLSearchParams(location.search);
  const client = createCheckoutClient();
  const lang = resolveCheckoutLang({ param: params.get('lang'), pending: client.pending(), stored: localStorage.getItem('lang') });
  const isEn = lang === 'en';
  document.title = isEn ? 'Image license | Amit Photos' : 'רישיון לתמונה | Amit Photos';
  document.documentElement.lang = lang;
  document.documentElement.dir = isEn ? 'ltr' : 'rtl';
  document.querySelectorAll('[data-he][data-en]').forEach(el => { el.textContent = el.dataset[lang]; });
  const status = document.getElementById('checkout-status');
  const button = document.getElementById('checkout-pay');
  const consent = document.getElementById('checkout-consent');
  const retry = document.getElementById('checkout-retry');
  const restart = document.getElementById('checkout-restart');
  const controls = document.getElementById('checkout-controls');
  const words = {
    disabled: isEn ? 'Online payment is temporarily unavailable. You can contact us about this image.' : 'התשלום המקוון אינו זמין כרגע. אפשר לפנות אלינו לגבי התמונה.',
    error: isEn ? 'We could not complete this step. Retry this order or contact us. If you approved payment, do not create another order.' : 'לא הצלחנו להשלים את השלב. נסו שוב את אותה הזמנה או פנו אלינו. אם אישרתם תשלום, אל תיצרו הזמנה חדשה.',
    missing: isEn ? 'Choose an image in the gallery first.' : 'בחרו תחילה תמונה בגלריה.',
    verifying: isEn ? 'Verifying your payment…' : 'מאמתים את התשלום…',
    success: isEn ? 'Payment verified. Your download is ready (one use, within 24 hours).' : 'התשלום אומת. ההורדה מוכנה (שימוש אחד בתוך 24 שעות).',
    cancelled: isEn ? 'You returned without completing checkout. No capture was requested by this page.' : 'חזרתם ללא השלמת הרכישה. העמוד לא ביקש לחייב את ההזמנה.',
    changed: isEn ? 'The price changed. Review the new price and confirm the license again.' : 'המחיר השתנה. בדקו את המחיר החדש ואשרו שוב את הרישיון.',
    declined: isEn ? 'PayPal declined the payment method. Return to the image details, then choose a different payment method in PayPal.' : 'PayPal דחה את אמצעי התשלום. חזרו לפרטי התמונה, ולאחר מכן בחרו אמצעי תשלום אחר ב־PayPal.',
  };
  let quote;
  const photoId = params.get('photoId') || client.pending()?.photoId;
  async function capture() {
    controls.hidden = true;
    document.getElementById('checkout-price').hidden = true;
    retry.hidden = true;
    restart.hidden = true;
    status.textContent = words.verifying;
    try {
      const result = await client.capture(params.get('token'));
      status.textContent = words.success;
      const download = document.getElementById('checkout-download');
      download.href = result.url;
      download.hidden = false;
      document.getElementById('checkout-title').textContent = result.title;
      // Remove return parameters; never place download tokens in the page URL or analytics.
      history.replaceState(null, '', isEn ? '/checkout/?lang=en' : '/checkout/');
    } catch (error) {
      const declined = error.message === 'PAYMENT_DECLINED';
      status.textContent = declined ? words.declined : words.error;
      retry.hidden = declined;
      restart.hidden = !declined;
    }
  }
  retry.addEventListener('click', capture);
  restart.addEventListener('click', () => {
    const id = client.restartAfterDecline();
    location.assign('/checkout/?' + new URLSearchParams({ photoId: id, lang }));
  });
  if (params.get('approved') === '1') {
    await capture(); // Server verifies/captures; the return URL alone never means paid.
    return;
  }
  if (!photoId) { controls.hidden = true; status.textContent = words.missing; return; }
  try {
    quote = await client.quote(photoId);
    document.getElementById('checkout-title').textContent = quote.title;
    document.getElementById('checkout-price').textContent = new Intl.NumberFormat(isEn ? 'en-IL' : 'he-IL', { style: 'currency', currency: 'ILS' }).format(quote.amountMinor / 100);
    status.textContent = params.get('cancelled') === '1' ? words.cancelled : quote.enabled ? '' : words.disabled;
    consent.disabled = quote.enabled !== true;
    button.disabled = true;
    consent.addEventListener('change', () => { button.disabled = quote.enabled !== true || !consent.checked; });
    button.addEventListener('click', async () => {
      button.disabled = true;
      consent.disabled = true;
      try {
        // Re-read before creation so changes must be seen and accepted again.
        const fresh = await client.quote(photoId);
        if (fresh.amountMinor !== quote.amountMinor || fresh.enabled !== true) {
          quote = fresh;
          document.getElementById('checkout-price').textContent = new Intl.NumberFormat(isEn ? 'en-IL' : 'he-IL', { style: 'currency', currency: 'ILS' }).format(quote.amountMinor / 100);
          consent.checked = false;
          throw new Error('PRICE_CHANGED');
        }
        location.assign(await client.start(quote, consent.checked, lang));
      } catch (error) {
        status.textContent = !quote.enabled ? words.disabled : error.message === 'PRICE_CHANGED' ? words.changed : words.error;
        consent.disabled = quote.enabled !== true;
        button.disabled = quote.enabled !== true || !consent.checked;
      }
    });
  } catch { controls.hidden = true; status.textContent = words.error; }
}

if (typeof document !== 'undefined') mount().catch(() => {
  document.getElementById('checkout-status').textContent = 'לא ניתן לטעון את הרכישה / Checkout unavailable';
  document.getElementById('checkout-pay').disabled = true;
});
