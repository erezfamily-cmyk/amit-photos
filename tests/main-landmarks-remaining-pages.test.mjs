import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { servePhotoPage, handleFreeGuide } from '../worker.js';

// Follow-up to 8ac1da3e (category pages only). This closes the rest of the list from the site
// audit: photo pages, the live free-guide SSR page, locations (listing + detail), privacy and
// accessibility — none of these had a <main> landmark at all.

function assertExactlyOneMain(html, label) {
  const opens = (html.match(/<main[\s>]/g) || []).length;
  const closes = (html.match(/<\/main>/g) || []).length;
  assert.equal(opens, 1, `${label}: expected exactly one <main> open tag, found ${opens}`);
  assert.equal(closes, 1, `${label}: expected exactly one </main> close tag, found ${closes}`);
}

function fakeDB(row, related = []) {
  return {
    DB: {
      prepare(sql) {
        return {
          bind: () => ({
            first: async () => row,
            all: async () => ({ results: related }),
          }),
        };
      },
    },
  };
}

test('servePhotoPage: exactly one <main>, wraps the photo/info/related content, excludes only the back-link', async () => {
  const env = fakeDB({ id: 'p1', title: 'נוף הרים', description: 'תיאור', thumbnail: '/photos/p1.webp', category: 'nature' });
  const res = await servePhotoPage('p1', env);
  const html = await res.text();
  assertExactlyOneMain(html, 'servePhotoPage');
  const mainContent = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.match(mainContent, /class="photo-wrap"/);
  assert.match(mainContent, /<h1>/);
  assert.match(html.slice(0, html.indexOf('<main')), /class="back"/, 'back link should stay outside <main>, like the homepage nav');
});

test('handleFreeGuide (live SSR): exactly one <main>, both languages', async () => {
  const env = { DB: { prepare: () => ({ first: async () => ({ id: 'p1', r2_key: 'p1.webp', title: 'Test' }) }) } };
  for (const url of ['https://amitphotos.com/free-guide/', 'https://amitphotos.com/free-guide/?lang=en']) {
    const res = await handleFreeGuide(new Request(url), env);
    const html = await res.text();
    assertExactlyOneMain(html, `handleFreeGuide (${url})`);
  }
});

test('locations/spot/index.html: exactly one <main>, wraps hero/map/gallery, excludes the lightbox and correction modal', () => {
  const html = readFileSync(fileURLToPath(new URL('../locations/spot/index.html', import.meta.url)), 'utf8');
  assertExactlyOneMain(html, 'locations/spot/index.html');
  const mainContent = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.match(mainContent, /id="spot-hero"/);
  assert.match(mainContent, /id="gallery-section"/);
  assert.doesNotMatch(mainContent, /id="correction-modal"/, 'dialogs should stay outside <main>, same convention as the homepage lightbox/modals');
  assert.doesNotMatch(mainContent, /id="lb"/);
});

test('locations/index.html: exactly one <main>, wraps hero/filters/grid, excludes the suggest modal', () => {
  const html = readFileSync(fileURLToPath(new URL('../locations/index.html', import.meta.url)), 'utf8');
  assertExactlyOneMain(html, 'locations/index.html');
  const mainContent = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.match(mainContent, /<h1>/);
  assert.match(mainContent, /id="grid"/);
  assert.doesNotMatch(mainContent, /id="suggest-modal"/);
});

test('privacy/index.html: exactly one <main>, wraps both language sections', () => {
  const html = readFileSync(fileURLToPath(new URL('../privacy/index.html', import.meta.url)), 'utf8');
  assertExactlyOneMain(html, 'privacy/index.html');
  const mainContent = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.match(mainContent, /id="section-he"/);
  assert.match(mainContent, /id="section-en"/);
});

test('accessibility/index.html: exactly one <main>, wraps both language sections', () => {
  const html = readFileSync(fileURLToPath(new URL('../accessibility/index.html', import.meta.url)), 'utf8');
  assertExactlyOneMain(html, 'accessibility/index.html');
  const mainContent = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.match(mainContent, /id="section-he"/);
  assert.match(mainContent, /id="section-en"/);
});
