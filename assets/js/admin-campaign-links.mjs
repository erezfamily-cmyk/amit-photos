export const DESTINATIONS = new Set([
  '/free-guide/',
  '/licensing/',
  '/business/',
  '/#gallery',
  '/camera/',
  '/locations/',
]);

export const SOURCES = new Set([
  'instagram',
  'facebook',
  'threads',
  'tiktok',
  'youtube',
  'newsletter',
  'whatsapp',
  'partner',
  'linkedin',
]);

export const MEDIUMS = new Set(['social', 'email', 'message', 'referral']);

export function cleanToken(value, maxLen = 80) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen);
}

export function containsObviousPii(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (/\bmailto:|\btel:/i.test(raw)) return true;
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(raw)) return true;
  if (/\+972[\s().-]*\d/i.test(raw)) return true;
  if (/\b05\d[\s().-]*\d{3}[\s().-]*\d{4}\b/.test(raw)) return true;
  return false;
}

export function buildCampaignUrl({
  destination,
  source,
  medium,
  campaign,
  content = '',
  origin = 'https://amitphotos.com',
}) {
  if (!DESTINATIONS.has(destination)) throw new Error('invalid_destination');
  if (!SOURCES.has(source)) throw new Error('invalid_source');
  if (!MEDIUMS.has(medium)) throw new Error('invalid_medium');
  if (containsObviousPii(campaign) || containsObviousPii(content)) throw new Error('possible_pii');

  const safeCampaign = cleanToken(campaign, 80);
  const safeContent = cleanToken(content, 80);
  if (!safeCampaign) throw new Error('missing_campaign');

  const url = new URL(destination, origin);
  url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', medium);
  url.searchParams.set('utm_campaign', safeCampaign);
  if (safeContent) url.searchParams.set('utm_content', safeContent);
  return url.toString();
}

function initCampaignLinkBuilder() {
  const destinationEl = document.getElementById('campaign-destination');
  const sourceEl = document.getElementById('campaign-source');
  const mediumEl = document.getElementById('campaign-medium');
  const campaignEl = document.getElementById('campaign-name');
  const contentEl = document.getElementById('campaign-content');
  const outputEl = document.getElementById('campaign-result');
  const statusEl = document.getElementById('campaign-link-status');
  const openBtn = document.getElementById('campaign-open-btn');
  const buildBtn = document.getElementById('campaign-build-btn');
  const copyBtn = document.getElementById('campaign-copy-btn');

  if (!destinationEl || !sourceEl || !mediumEl || !campaignEl || !outputEl) return;

  let lastUrl = '';

  function setStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = isError ? 'var(--red, #e05555)' : 'var(--text-muted)';
  }

  function clearResult() {
    lastUrl = '';
    outputEl.value = '';
    if (openBtn) openBtn.disabled = true;
  }

  function build() {
    clearResult();
    try {
      lastUrl = buildCampaignUrl({
        destination: destinationEl.value,
        source: sourceEl.value,
        medium: mediumEl.value,
        campaign: campaignEl.value,
        content: contentEl?.value || '',
      });
      outputEl.value = lastUrl;
      if (openBtn) openBtn.disabled = false;
      setStatus('הקישור מוכן. אל תכניס שמות, אימיילים, טלפונים או מידע אישי ל-UTM.');
      return lastUrl;
    } catch (error) {
      if (error?.message === 'possible_pii') {
        setStatus('זוהה מידע שעשוי להיות אישי. אין להכניס אימייל או טלפון ל-UTM.', true);
      } else if (error?.message === 'missing_campaign') {
        setStatus('יש להזין שם campaign.', true);
      } else {
        setStatus('ערך לא חוקי — הקישור לא נוצר.', true);
      }
      return '';
    }
  }

  buildBtn?.addEventListener('click', build);

  copyBtn?.addEventListener('click', async () => {
    const value = lastUrl || build();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setStatus('הקישור הועתק. אל תכלול מידע אישי ב-UTM.');
    } catch {
      outputEl.focus();
      outputEl.select();
      setStatus('סמן והעתק את הקישור ידנית.');
    }
  });

  openBtn?.addEventListener('click', () => {
    const value = lastUrl || build();
    if (!value) return;
    window.open(value, '_blank', 'noopener');
  });

  [destinationEl, sourceEl, mediumEl].forEach((el) => {
    el.addEventListener('change', build);
  });
  [campaignEl, contentEl].filter(Boolean).forEach((el) => {
    el.addEventListener('input', clearResult);
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCampaignLinkBuilder, { once: true });
  } else {
    initCampaignLinkBuilder();
  }
}
