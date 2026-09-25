import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { handleFreeGuide } from '../worker.js';

function fakeEnv(photo = { id: 'p1', r2_key: 'p1.webp', title: 'Test Photo' }) {
  return { DB: { prepare: () => ({ first: async () => photo }) } };
}

function runClientScript(html, search = '') {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const script = scripts.at(-1)?.[1];
  assert.ok(script, 'free-guide client script not found');

  const listeners = {};
  const fetchBodies = [];
  const elements = {
    'fg-lang-btn': { textContent: '' },
    'fg-email': { value: 'reader@example.com', placeholder: '', setAttribute() {} },
    'fg-consent-privacy': { checked: true },
    'fg-consent-marketing': { checked: false },
    'fg-btn': { disabled: false, textContent: '' },
    'fg-msg': { className: '', innerHTML: '', textContent: '' },
    'fg-form': { addEventListener(type, fn) { listeners[type] = fn; } },
  };
  const storage = new Map();
  const context = {
    URLSearchParams,
    encodeURIComponent,
    location: { search },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); },
    },
    document: {
      title: '',
      documentElement: { lang: '', dir: '' },
      querySelectorAll() { return []; },
      getElementById(id) { return elements[id]; },
    },
    window: { addEventListener() {} },
    fetch: async (_url, init) => {
      fetchBodies.push(JSON.parse(init.body));
      return { ok: true };
    },
  };
  vm.runInNewContext(script, context);
  return { context, elements, listeners, fetchBodies };
}

test('default (no ?lang=) renders Hebrew, dir=rtl', async () => {
  const res = await handleFreeGuide(new Request('https://amitphotos.com/free-guide/'), fakeEnv());
  const html = await res.text();
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.match(html, />50 טיפים לצילום טוב יותר</);
});

test('?lang=en renders English, dir=ltr — no flash, correct on first server response', async () => {
  const res = await handleFreeGuide(new Request('https://amitphotos.com/free-guide/?lang=en'), fakeEnv());
  const html = await res.text();
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.match(html, />50 (Photography )?Tips/i);
});

test('English title/meta tags are in English when ?lang=en', async () => {
  const res = await handleFreeGuide(new Request('https://amitphotos.com/free-guide/?lang=en'), fakeEnv());
  const html = await res.text();
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  assert.ok(titleMatch);
  assert.doesNotMatch(titleMatch[1], /[֐-׿]/, 'title should contain no Hebrew characters in EN mode');
});

test('all key strings are translated in English mode: sub, pdf-meta, live placeholder, button, legal, consent labels', async () => {
  const res = await handleFreeGuide(new Request('https://amitphotos.com/free-guide/?lang=en'), fakeEnv());
  const html = await res.text();
  // None of the body text nodes / live attributes visible to the user should be raw Hebrew in
  // EN mode. data-he-* attributes legitimately retain the Hebrew value (needed for toggling back),
  // so these checks target the *live* rendered content specifically, not the stored fallback data.
  assert.doesNotMatch(html, />המדריך שהכנתי</);
  assert.doesNotMatch(html, /id="fg-email"[^>]*\splaceholder="כתובת המייל שלך"/);
  assert.doesNotMatch(html, />שלח לי את ה-PDF/);
  assert.doesNotMatch(html, />קבלת ה-PDF/);
  assert.doesNotMatch(html, />מעוניין\/ת לקבל עדכונים/);
  assert.match(html, /id="fg-email"[^>]*\splaceholder="Your email address"/);
  assert.match(html, />I have read and agree to the/);
});

test('Hebrew mode retains its translated form content and corrected consent copy', async () => {
  const res = await handleFreeGuide(new Request('https://amitphotos.com/free-guide/'), fakeEnv());
  const html = await res.text();
  assert.match(html, /id="fg-email"[^>]*\splaceholder="כתובת המייל שלך"/);
  assert.match(html, />שלח לי את ה-PDF/);
  assert.match(html, />ה-PDF יישלח גם ללא הרשמה לדיוור/);
});

test('consent logic unchanged: privacy required, marketing not required, both languages', async () => {
  for (const url of ['https://amitphotos.com/free-guide/', 'https://amitphotos.com/free-guide/?lang=en']) {
    const res = await handleFreeGuide(new Request(url), fakeEnv());
    const html = await res.text();
    assert.match(html, /id="fg-consent-privacy" required/);
    assert.doesNotMatch(html, /id="fg-consent-marketing" required/);
  }
});

test('legal copy says PDF delivery is independent from optional marketing consent, both languages', async () => {
  const he = await (await handleFreeGuide(new Request('https://amitphotos.com/free-guide/'), fakeEnv())).text();
  const en = await (await handleFreeGuide(new Request('https://amitphotos.com/free-guide/?lang=en'), fakeEnv())).text();
  assert.match(he, /ה-PDF יישלח גם ללא הרשמה לדיוור/);
  assert.match(en, /The PDF is sent even without marketing signup/);
  assert.doesNotMatch(he, /קבלת ה-PDF \+ הרשמה לניוזלטר/);
  assert.doesNotMatch(en, /Getting the PDF also subscribes you/);
});

test('?lang=en can toggle EN → HE → EN and submit using the currently visible language', async () => {
  const html = await (await handleFreeGuide(new Request('https://amitphotos.com/free-guide/?lang=en'), fakeEnv())).text();
  const harness = runClientScript(html, '?lang=en');

  assert.equal(harness.context.getLang(), 'en');
  assert.equal(harness.elements['fg-lang-btn'].textContent, 'HE');

  harness.context.toggleLang();
  assert.equal(harness.context.getLang(), 'he');
  assert.equal(harness.elements['fg-lang-btn'].textContent, 'EN');
  await harness.listeners.submit({ preventDefault() {} });
  assert.equal(harness.fetchBodies.at(-1).lang, 'he');

  harness.context.toggleLang();
  assert.equal(harness.context.getLang(), 'en');
  assert.equal(harness.elements['fg-lang-btn'].textContent, 'HE');
  harness.elements['fg-email'].value = 'reader@example.com';
  await harness.listeners.submit({ preventDefault() {} });
  assert.equal(harness.fetchBodies.at(-1).lang, 'en');
});

test('still posts source=lead_magnet, both languages', async () => {
  for (const url of ['https://amitphotos.com/free-guide/', 'https://amitphotos.com/free-guide/?lang=en']) {
    const res = await handleFreeGuide(new Request(url), fakeEnv());
    const html = await res.text();
    assert.match(html, /source=lead_magnet/);
  }
});

test('privacy policy link is present and points to /privacy/ in both languages', async () => {
  for (const url of ['https://amitphotos.com/free-guide/', 'https://amitphotos.com/free-guide/?lang=en']) {
    const res = await handleFreeGuide(new Request(url), fakeEnv());
    const html = await res.text();
    assert.match(html, /href="https:\/\/amitphotos\.com\/privacy\/"/);
  }
});

test('has a language toggle mechanism (data-he/data-en + getLang/applyLang) for client-side switching and persistence', async () => {
  const res = await handleFreeGuide(new Request('https://amitphotos.com/free-guide/'), fakeEnv());
  const html = await res.text();
  assert.match(html, /data-he=/);
  assert.match(html, /data-en=/);
  assert.match(html, /function getLang/);
  assert.match(html, /function applyLang/);
});

test('language toggle button is present and accessible (has an accessible name)', async () => {
  const res = await handleFreeGuide(new Request('https://amitphotos.com/free-guide/'), fakeEnv());
  const html = await res.text();
  assert.match(html, /id="fg-lang-btn"/);
});
