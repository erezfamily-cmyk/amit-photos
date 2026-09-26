import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleNlIssue } from '../worker.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/style.css', import.meta.url), 'utf8');
const gallery = readFileSync(new URL('../assets/js/gallery.js', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../assets/js/i18n.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

test('trial banner precedes a sticky nav, so it is visible before the nav sticks', () => {
  assert.ok(html.indexOf('id="beta-banner"') < html.indexOf('id="main-nav"'));
  const navRule = css.match(/\/\* ===== NAV ===== \*\/[\s\S]*?nav\s*\{([\s\S]*?)\}/)?.[1] || '';
  assert.match(navRule, /position:\s*sticky/);
  assert.match(navRule, /top:\s*0/);
  assert.doesNotMatch(navRule, /position:\s*fixed/);
});

test('homepage starts in a fail-closed purchase state before JavaScript or API responses arrive', () => {
  assert.match(html, /<body[^>]*data-payments-state="disabled"/);
  assert.match(css, /body\[data-payments-state="disabled"\][^{]*\.payments-enabled-only\s*\{[^}]*display:\s*none\s*!important/);
  assert.match(css, /body\[data-payments-state="enabled"\][^{]*\.payments-disabled-only\s*\{[^}]*display:\s*none\s*!important/);
});

test('disabled-purchase notice offers a real contact route in Hebrew and English', () => {
  assert.match(html, /class="[^"]*payments-disabled-only[^"]*"/);
  assert.match(html, /href="tel:0503333227"/);
  assert.match(i18n, /'payments\.disabled\.title'/);
  assert.match(i18n, /הרכישה המקוונת נמצאת בשדרוג אבטחה/);
  assert.match(i18n, /Online purchasing is undergoing a security upgrade/);
});

test('PayPal checkout instructions and print-order FAQ are shown only when payments are enabled', () => {
  assert.match(html, /class="process-grid payments-enabled-only"/);
  assert.match(html, /id="print-faq"[^>]*class="[^"]*payments-enabled-only/);
  assert.match(html, /class="[^"]*pricing-cta[^"]*payments-enabled-only/);
});

test('payment state flips to enabled only after an exact enabled:true server response', () => {
  assert.match(gallery, /function applyPaymentsAvailability\(enabled\)/);
  assert.match(gallery, /PURCHASES_ENABLED\s*=\s*enabled\s*===\s*true/);
  assert.match(gallery, /document\.body\.dataset\.paymentsState\s*=\s*PURCHASES_ENABLED\s*\?\s*'enabled'\s*:\s*'disabled'/);
  assert.match(gallery, /applyPaymentsAvailability\(status\?\.enabled\)/);
});

test('published newsletter issues do not advertise PayPal or sale checkout while payments are disabled', () => {
  const start = worker.indexOf('export async function handleNlIssue');
  const end = worker.indexOf('async function handleAdminNlList', start);
  const source = worker.slice(start, end);
  assert.match(source, /const purchasesEnabled\s*=\s*paymentsEnabled\(env\)/);
  assert.match(source, /purchasesEnabled\s*\?\s*`[\s\S]*PayPal[\s\S]*`\s*:\s*`[\s\S]*שדרוג אבטחה/);
  assert.match(source, /const saleBannerSection\s*=\s*purchasesEnabled\s*&&/);
});

function newsletterEnv(paymentsFlag) {
  const issue = {
    type: 'full',
    title_he: 'גיליון בדיקה',
    title_en: 'Test issue',
    published_at: '2026-09-26T00:00:00.000Z',
    content_json: JSON.stringify({
      hero: {
        photo_id: 'photo-1',
        photo_url: 'https://example.com/photo.jpg',
        title_he: 'תמונת בדיקה',
        text_he: 'טקסט בדיקה',
        text_en: 'Test text'
      },
      sale: {
        title_he: 'מבצע שלא אמור להופיע',
        desc_he: 'תיאור מבצע',
        original_price: '₪100',
        sale_price: '₪50',
        discount_label: '50%'
      }
    })
  };
  return {
    PAYMENTS_ENABLED: paymentsFlag,
    DB: {
      prepare() {
        return { bind() { return { first: async () => issue }; } };
      }
    }
  };
}

test('rendered newsletter issue is fail-closed when the payments flag is false', async () => {
  const response = await handleNlIssue(newsletterEnv('false'), 'test-issue', false);
  const rendered = await response.text();
  assert.match(rendered, /הרכישה המקוונת נמצאת בשדרוג אבטחה/);
  assert.match(rendered, /href="tel:\+972503333227"/);
  assert.doesNotMatch(rendered, /Buy with PayPal|רכוש קובץ ב-PayPal/);
  assert.doesNotMatch(rendered, /מבצע שלא אמור להופיע|₪50/);
});

test('rendered newsletter issue restores checkout messaging only for exact true', async () => {
  const response = await handleNlIssue(newsletterEnv('true'), 'test-issue', false);
  const rendered = await response.text();
  assert.match(rendered, /Buy with PayPal|רכוש קובץ ב-PayPal/);
  assert.match(rendered, /מבצע שלא אמור להופיע|₪50/);
  assert.doesNotMatch(rendered, /הרכישה המקוונת נמצאת בשדרוג אבטחה/);
});
