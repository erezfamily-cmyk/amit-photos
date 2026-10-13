const STORAGE_KEY = 'amit-digital-checkout-v1';
const MAX_AGE = 24 * 60 * 60 * 1000;

export function createCheckoutClient({ fetcher = fetch, storage = sessionStorage, now = Date.now, uuid = () => crypto.randomUUID() } = {}) {
  let busy = false;
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
    async start(quote, accepted) {
      if (busy) throw new Error('BUSY');
      if (!accepted || quote.enabled !== true || quote.currency !== 'ILS' || quote.license !== 'personal') throw new Error('CHECKOUT_DISABLED');
      busy = true;
      try {
        let attempt = read();
        if (!attempt || attempt.photoId !== quote.photoId || attempt.amountMinor !== quote.amountMinor) {
          attempt = { photoId: quote.photoId, amountMinor: quote.amountMinor, key: uuid(), createdAt: now() };
          // Persist before the request: retries after a lost response use the same key.
          save(attempt);
        }
        const data = await json('/api/paypal/create-order', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.key },
          body: JSON.stringify({ type: 'digital', photoId: quote.photoId, sku: 'large', currency: 'ILS', licenseAccepted: true, expectedAmountMinor: quote.amountMinor }),
        });
        const approval = new URL(data.approveUrl);
        if (approval.protocol !== 'https:' || approval.hostname !== 'www.sandbox.paypal.com' || approval.username || approval.password ||
            !/^[A-Za-z0-9_-]{8,64}$/.test(data.paypalOrderId)) throw new Error('INVALID_APPROVAL');
        save({ ...attempt, paypalOrderId: data.paypalOrderId });
        return approval.href;
      } finally { busy = false; }
    },
    async capture(returnedToken) {
      if (busy) throw new Error('BUSY');
      const attempt = read();
      if (!attempt?.paypalOrderId || returnedToken !== attempt.paypalOrderId) throw new Error('RETURN_MISMATCH');
      busy = true;
      try {
        const result = await json('/api/paypal/capture-order', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paypalOrderId: attempt.paypalOrderId }),
        });
        if (!/^\/api\/download\/[A-Za-z0-9_-]+$/.test(result.url)) throw new Error('INVALID_DOWNLOAD');
        return result; // Keep the order ID for safe recovery; never store the bearer download URL.
      } finally { busy = false; }
    },
  };
}

async function mount() {
  const params = new URLSearchParams(location.search);
  const isEn = params.get('lang') === 'en' || localStorage.getItem('lang') === 'en';
  const lang = isEn ? 'en' : 'he';
  document.title = isEn ? 'Image license | Amit Photos' : 'רישיון לתמונה | Amit Photos';
  document.documentElement.lang = lang;
  document.documentElement.dir = isEn ? 'ltr' : 'rtl';
  document.querySelectorAll('[data-he][data-en]').forEach(el => { el.textContent = el.dataset[lang]; });
  const client = createCheckoutClient();
  const status = document.getElementById('checkout-status');
  const button = document.getElementById('checkout-pay');
  const consent = document.getElementById('checkout-consent');
  const retry = document.getElementById('checkout-retry');
  const controls = document.getElementById('checkout-controls');
  const words = {
    disabled: isEn ? 'Online payment is temporarily unavailable. You can contact us about this image.' : 'התשלום המקוון אינו זמין כרגע. אפשר לפנות אלינו לגבי התמונה.',
    error: isEn ? 'We could not complete this step. Retry this order or contact us. If you approved payment, do not create another order.' : 'לא הצלחנו להשלים את השלב. נסו שוב את אותה הזמנה או פנו אלינו. אם אישרתם תשלום, אל תיצרו הזמנה חדשה.',
    missing: isEn ? 'Choose an image in the gallery first.' : 'בחרו תחילה תמונה בגלריה.',
    verifying: isEn ? 'Verifying your payment…' : 'מאמתים את התשלום…',
    success: isEn ? 'Payment verified. Your download is ready (one use, within 24 hours).' : 'התשלום אומת. ההורדה מוכנה (שימוש אחד בתוך 24 שעות).',
    cancelled: isEn ? 'You returned without completing checkout. No capture was requested by this page.' : 'חזרתם ללא השלמת הרכישה. העמוד לא ביקש לחייב את ההזמנה.',
    changed: isEn ? 'The price changed. Review the new price and confirm the license again.' : 'המחיר השתנה. בדקו את המחיר החדש ואשרו שוב את הרישיון.',
  };
  let quote;
  const photoId = params.get('photoId') || client.pending()?.photoId;
  async function capture() {
    controls.hidden = true;
    retry.hidden = true;
    status.textContent = words.verifying;
    try {
      const result = await client.capture(params.get('token'));
      status.textContent = words.success;
      const download = document.getElementById('checkout-download');
      download.href = result.url;
      download.hidden = false;
      document.getElementById('checkout-title').textContent = result.title;
      // Remove return parameters; never place download tokens in the page URL or analytics.
      history.replaceState(null, '', '/checkout/');
    } catch {
      status.textContent = words.error;
      retry.hidden = false;
    }
  }
  retry.addEventListener('click', capture);
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
        location.assign(await client.start(quote, consent.checked));
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
