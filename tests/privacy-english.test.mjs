import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const html = readFileSync(fileURLToPath(new URL('../privacy/index.html', import.meta.url)), 'utf8');

function fakeClassList(initial = []) {
  const values = new Set(initial);
  return {
    toggle(name, force) {
      if (force === undefined ? !values.has(name) : force) values.add(name);
      else values.delete(name);
    },
    contains(name) { return values.has(name); },
  };
}

function runPrivacyScripts(search = '', storedLang = null) {
  const storage = new Map(storedLang ? [['lang', storedLang]] : []);
  const elements = {
    'section-he': { style: {} },
    'section-en': { style: {} },
    'btn-he': { classList: fakeClassList(['active']), attrs: {}, setAttribute(name, value) { this.attrs[name] = value; } },
    'btn-en': { classList: fakeClassList(), attrs: {}, setAttribute(name, value) { this.attrs[name] = value; } },
    'privacy-a11y-link': { textContent: '' },
  };
  const metaDescription = { content: '' };
  const documentElement = {
    lang: '', dir: '', dataset: {},
    setAttribute(name, value) { this[name] = value; },
  };
  const context = {
    URLSearchParams,
    location: { search },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); },
    },
    document: {
      title: '', documentElement,
      getElementById(id) { return elements[id]; },
      querySelector(selector) { return selector === 'meta[name="description"]' ? metaDescription : null; },
    },
    addEventListener() {},
  };
  context.window = context;

  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 2, 'expected an early language bootstrap and the page controller');
  for (const script of scripts) vm.runInNewContext(script[1], context);

  return { context, elements, storage, metaDescription, documentElement };
}

test('English policy contains the complete ten-section translation', () => {
  // the closing wrapper is <main class="content"> (added for a landmark fix after this test was
  // written), not <div class="content"> — accept either so this keeps testing section-en's
  // content regardless of what its parent element is.
  const english = html.match(/<div class="section-en"[\s\S]*?<\/div>\s*<\/(?:div|main)>/)?.[0] || '';
  assert.match(english, /<h1>Privacy Policy<\/h1>/);
  assert.equal((english.match(/<h2>/g) || []).length, 10);
  assert.match(english, /For any privacy-related questions/);
});

test('?lang=en initializes English before CSS and renders English metadata and controls', () => {
  const firstInlineScript = html.indexOf('<script>');
  assert.ok(firstInlineScript > 0 && firstInlineScript < html.indexOf('<style>'), 'language bootstrap must run before CSS');

  const page = runPrivacyScripts('?lang=en');
  assert.equal(page.documentElement.lang, 'en');
  assert.equal(page.documentElement.dir, 'ltr');
  assert.equal(page.documentElement.dataset.lang, 'en');
  assert.equal(page.elements['section-he'].style.display, 'none');
  assert.equal(page.elements['section-en'].style.display, 'block');
  assert.equal(page.context.document.title, 'Privacy Policy | Amit Photos');
  assert.match(page.metaDescription.content, /privacy policy/i);
  assert.equal(page.elements['privacy-a11y-link'].textContent, 'Accessibility Statement');
  assert.equal(page.elements['btn-en'].attrs['aria-pressed'], 'true');
  assert.equal(page.storage.get('lang'), 'en');
});

test('?lang=en can toggle EN → HE → EN without the query parameter overriding the active language', () => {
  const page = runPrivacyScripts('?lang=en');

  page.context.setLang('he');
  assert.equal(page.documentElement.lang, 'he');
  assert.equal(page.documentElement.dir, 'rtl');
  assert.equal(page.elements['section-he'].style.display, 'block');
  assert.equal(page.elements['section-en'].style.display, 'none');
  assert.equal(page.context.document.title, 'מדיניות פרטיות | Amit Photos');
  assert.equal(page.elements['privacy-a11y-link'].textContent, 'הצהרת נגישות');
  assert.equal(page.storage.get('lang'), 'he');

  page.context.setLang('en');
  assert.equal(page.documentElement.lang, 'en');
  assert.equal(page.elements['section-en'].style.display, 'block');
  assert.equal(page.storage.get('lang'), 'en');
});

test('without a query parameter, the page honors a valid stored language preference', () => {
  const page = runPrivacyScripts('', 'en');
  assert.equal(page.documentElement.lang, 'en');
  assert.equal(page.elements['section-en'].style.display, 'block');
});

test('invalid stored language safely falls back to Hebrew', () => {
  const page = runPrivacyScripts('', 'fr');
  assert.equal(page.documentElement.lang, 'he');
  assert.equal(page.documentElement.dir, 'rtl');
  assert.equal(page.elements['section-he'].style.display, 'block');
});

test('language buttons expose pressed state and the accessibility link is translatable', () => {
  assert.match(html, /id="btn-he"[^>]*aria-pressed="true"/);
  assert.match(html, /id="btn-en"[^>]*aria-pressed="false"/);
  assert.match(html, /id="privacy-a11y-link"[^>]*data-he="הצהרת נגישות"[^>]*data-en="Accessibility Statement"/);
});

test('the Worker serves /privacy/ through the static asset fallback', () => {
  const worker = readFileSync(fileURLToPath(new URL('../worker.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(worker, /path === ['"]\/privacy\/?['"]/);
  assert.match(worker, /const res = await env\.ASSETS\.fetch\(request\)/);
});
