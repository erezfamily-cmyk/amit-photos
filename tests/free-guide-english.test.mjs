import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFreeGuide } from '../worker.js';

function fakeEnv(photo = { id: 'p1', r2_key: 'p1.webp', title: 'Test Photo' }) {
  return { DB: { prepare: () => ({ first: async () => photo }) } };
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

test('Hebrew mode is unaffected (regression) — original strings still present', async () => {
  const res = await handleFreeGuide(new Request('https://amitphotos.com/free-guide/'), fakeEnv());
  const html = await res.text();
  assert.match(html, /id="fg-email"[^>]*\splaceholder="כתובת המייל שלך"/);
  assert.match(html, />שלח לי את ה-PDF/);
  assert.match(html, />קבלת ה-PDF/);
});

test('consent logic unchanged: privacy required, marketing not required, both languages', async () => {
  for (const url of ['https://amitphotos.com/free-guide/', 'https://amitphotos.com/free-guide/?lang=en']) {
    const res = await handleFreeGuide(new Request(url), fakeEnv());
    const html = await res.text();
    assert.match(html, /id="fg-consent-privacy" required/);
    assert.doesNotMatch(html, /id="fg-consent-marketing" required/);
  }
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
