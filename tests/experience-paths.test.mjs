import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const gallery = readFileSync(new URL('../assets/js/gallery.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/style.css', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../assets/js/i18n.js', import.meta.url), 'utf8');
const catalog = JSON.parse(readFileSync(new URL('../data/photos.json', import.meta.url), 'utf8'));

const match = gallery.match(/const EXPERIENCE_PATHS = Object\.freeze\((\{[\s\S]*?\})\);/);
assert.ok(match, 'Experience paths must use a static allowlist');
const paths = JSON.parse(JSON.stringify(vm.runInNewContext('(' + match[1] + ')')));
const byId = new Map(catalog.map(photo => [String(photo.id), photo]));

test('four paths exist with 4 unique known photo candidates per path', () => {
  assert.deepEqual(Object.keys(paths).sort(), ['details', 'places', 'quiet', 'wonder']);
  const ids = Object.values(paths).flat();
  assert.equal(ids.length, 16);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    const photo = byId.get(id);
    assert.ok(photo, 'Unknown photo ID: ' + id);
    assert.ok(Math.min(photo.width, photo.height) >= 1000, 'Low resolution: ' + id);
    assert.ok(photo.thumbnail, 'Missing preview: ' + id);
  }
});

test('details collection highlights subtle floral macro photography', () => {
  assert.deepEqual(paths.details, [
    '1c_MjQDRqBDKXXUs8J2IRYpUtq68hF0d5',
    '1T_sZuDJIECAtqscPBtZ1qoi7KECxxmLu',
    '1qAYmV4wg-5I8isvUTrP1kZnT1leAHkvA',
    '1WZUI8vzx_VBpg6yfXb_mAth6guweU2JH',
  ]);
  assert.equal(byId.get(paths.details[1]).title, 'פרחים ורודים בתקריב');
  assert.equal(byId.get(paths.details[2]).title, 'ורד ורוד עדין');
  assert.equal(byId.get(paths.details[3]).title, 'עדינות של טבע');
  assert.match(i18n, /'experience\.details\.desc': 'עדינות של הטבע'/);
  assert.match(i18n, /'experience\.details\.desc': 'The delicate beauty of nature'/);
  assert.match(html, /data-i18n="experience\.details\.desc">עדינות של הטבע/);
});

test('photo-led homepage cards keep the image dominant and text legible', () => {
  assert.match(css, /\.experience-card-media\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.experience-card::after\s*\{[^}]*linear-gradient/s);
  assert.match(css, /\.experience-card-copy\s*\{[^}]*z-index:\s*1/s);
  assert.match(css, /\.experience-card\s*\{[^}]*aspect-ratio:\s*3\s*\/\s*4/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('hero opens the emotional discovery only when a public route exists', () => {
  assert.match(html, /href="#gallery" class="hero-cta"/);
  assert.match(gallery, /const heroCta = document\.querySelector\('\.hero-cta\[href="#gallery"\]'\)/);
  assert.match(gallery, /if \(available > 0 && heroCta\) heroCta\.setAttribute\('href', '#experience'\)/);
  assert.match(gallery, /if \(!experiencePublicGalleryVerified\) \{\s*section\.hidden = true;\s*return;/);
});

test('photo choices resolve only from the current public gallery and hide unavailable paths', () => {
  assert.match(gallery, /const published = new Map\(allPhotos\.map\(photo => \[String\(photo\.id\), photo\]\)\)/);
  assert.match(gallery, /ids\.map\(id => published\.get\(id\)\)\.filter\(Boolean\)/);
  assert.match(gallery, /card\.hidden = matches\.length < 2/);
  assert.match(html, /<section class="experience-section" id="experience"[^>]*hidden>/);
  assert.match(gallery, /section\.hidden = available === 0;/);
  assert.match(gallery, /img\.src = getGalleryThumbUrl\(photo\.thumbnail \|\| photo\.url\)/);
  assert.doesNotMatch(html, /\/photos\/thumb\//);
});

test('experience paths fail closed if the public D1 gallery cannot be verified', () => {
  assert.match(gallery, /let experiencePublicGalleryVerified = false;/);
  assert.match(gallery, /async function loadPhotos\(\) \{[\s\S]*?experiencePublicGalleryVerified = false;/);
  assert.match(gallery, /if \(Array\.isArray\(apiPhotos\) && apiPhotos\.length > 0\) \{\s*\/\/ The original D1 route or Preview's public-production proxy returns only published images\.\s*experiencePublicGalleryVerified = true;/);
  assert.match(gallery, /function showExperiencePath\([^)]*\) \{\s*if \(!experiencePublicGalleryVerified\) return;/);
  assert.match(gallery, /function initExperiencePaths\(\) \{[\s\S]*?if \(!experiencePublicGalleryVerified\) \{\s*section\.hidden = true;/);
});

test('sandbox featured/gallery image URLs resolve against public assets, not isolated R2', () => {
  const start = gallery.indexOf('function normalizePhotoAssetUrlsForPreview(');
  const end = gallery.indexOf('function clearExperienceSelection(', start);
  assert.ok(start >= 0 && end > start, 'preview-only normalization helper exists');
  const helper = gallery.slice(start, end);
  const photo = {
    id: 'existing-public-photo',
    thumbnail: '/photos/thumb/1c_MjQDRqBDKXXUs8J2IRYpUtq68hF0d5.webp',
    url: '/photos/1c_MjQDRqBDKXXUs8J2IRYpUtq68hF0d5.webp',
  };
  const preview = vm.runInNewContext(helper + '\nnormalizePhotoAssetUrlsForPreview(photo);', {
    photo, location: { hostname: 'feature-experience-analytics-story-p-amit-photos-paypal-sandbox.erez-family.workers.dev' },
  });
  assert.equal(preview.thumbnail, 'https://amitphotos.com' + photo.thumbnail);
  assert.equal(preview.url, 'https://amitphotos.com' + photo.url);
  assert.equal(preview.id, photo.id);
  assert.match(gallery, /allPhotos = allPhotos\.map\(normalizePhotoAssetUrlsForPreview\)/);
  assert.ok(gallery.indexOf('allPhotos = allPhotos.map(normalizePhotoAssetUrlsForPreview);')
    < gallery.indexOf('injectImageObjectSchemas(allPhotos)'), 'normalize before gallery/featured rendering');
});

test('image URL repair does not change production or promote unpublished fallback rows', () => {
  const start = gallery.indexOf('function normalizePhotoAssetUrlsForPreview(');
  const end = gallery.indexOf('function clearExperienceSelection(', start);
  const helper = gallery.slice(start, end);
  const run = (hostname, photo) => vm.runInNewContext(helper + '\nnormalizePhotoAssetUrlsForPreview(photo);', {
    photo, location: { hostname },
  });
  const photo = { id: 'same-photo', thumbnail: '/photos/thumb/known.webp', url: '/photos/known.webp', published: 0 };
  const live = run('amitphotos.com', photo);
  assert.equal(live.thumbnail, photo.thumbnail);
  assert.equal(live.url, photo.url);
  const preview = run('feature-amit-photos-paypal-sandbox.erez-family.workers.dev', photo);
  assert.equal(preview.published, 0);
  assert.equal(preview.thumbnail, 'https://amitphotos.com/photos/thumb/known.webp');
  const noRewrite = run('feature-amit-photos-paypal-sandbox.erez-family.workers.dev',
    { thumbnail: 'https://amitphotos.com/photos/thumb/known.webp', url: '/api/admin/photos' });
  assert.equal(noRewrite.thumbnail, 'https://amitphotos.com/photos/thumb/known.webp');
  assert.equal(noRewrite.url, '/api/admin/photos');
  assert.match(gallery, /let experiencePublicGalleryVerified = false;/);
  assert.match(gallery, /if \(!experiencePublicGalleryVerified\) \{\s*section.hidden = true;/);
});

test('Cloudflare Sandbox Preview reads the published public photo source without loosening production', () => {
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(gallery, /const isSandboxPreview = location\.hostname\.endsWith\('-amit-photos-paypal-sandbox\.erez-family\.workers\.dev'\)/);
  assert.match(gallery, /const publicGalleryEndpoint = isSandboxPreview \? '\/api\/experience-preview-photos' : '\/api\/photos'/);
  assert.match(worker, /if \(path === '\/api\/experience-preview-photos'\) return handleExperiencePreviewPublicPhotos\(request, env\)/);
  assert.match(worker, /if \(!host\.endsWith\(EXPERIENCE_PREVIEW_HOST_SUFFIX\)\)/);
  assert.match(worker, /request\.method !== 'GET'/);
  assert.match(worker, /'https:\/\/www\.amitphotos\.com\/api\/photos'/);
  assert.match(worker, /'https:\/\/amitphotos\.com\/api\/photos'/);
  assert.match(worker, /for \(const url of publicGalleryUrls\)/);
  assert.match(worker, /redirect: 'error'/);
  assert.match(worker, /photo\.published !== 0 && photo\.published !== false/);
  assert.match(worker, /new Response\('Not found', \{ status: 404 \}\)/);
  assert.match(worker, /'public gallery unavailable'/);
  assert.doesNotMatch(worker.slice(worker.indexOf('async function handleExperiencePreviewPublicPhotos('),
    worker.indexOf('// ===== PHOTOS =====')), /admin=1|\/api\/admin|env\.DB|\.put\(|DELETE FROM|UPDATE photos/);
});

test('Sandbox service binding reads only published public photos without cross-worker fetch', async () => {
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  const source = worker.slice(worker.indexOf('const EXPERIENCE_PREVIEW_HOST_SUFFIX'),
    worker.indexOf('// ===== PHOTOS ====='));
  const calls = [];
  const ctx = {
    URL,
    Request,
    Response,
    fetch: async () => { throw new Error('network fetch must not occur with a binding'); },
    jsonRes: (value, status) => new Response(JSON.stringify(value), { status }),
  };
  vm.runInNewContext(source + '\nthis.previewHandler = handleExperiencePreviewPublicPhotos;', ctx);
  const req = { url: 'https://feature-amit-photos-paypal-sandbox.erez-family.workers.dev/api/experience-preview-photos', method: 'GET' };
  const env = { PUBLIC_GALLERY_SERVICE: { fetch: async request => {
    calls.push(request);
    return new Response(JSON.stringify([
      { id: 'published-one', published: 1, thumbnail: '/photos/thumb/one.webp' },
      { id: 'hidden-zero', published: 0, thumbnail: '/photos/thumb/zero.webp' },
      { id: 'hidden-false', published: false, thumbnail: '/photos/thumb/false.webp' },
    ]), { status: 200 });
  } } };
  const response = await ctx.previewHandler(req, env);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://amitphotos.com/api/photos');
  assert.equal(calls[0].method, 'GET');
  const data = await response.json();
  assert.deepEqual(data.map(p => p.id), ['published-one']);
  assert.equal(data[0].thumbnail, 'https://amitphotos.com/photos/thumb/one.webp');
  const prod = await ctx.previewHandler({url: 'https://amitphotos.com/api/experience-preview-photos',method:'GET'},env);
  assert.equal(prod.status,404);
  assert.equal(calls.length,1);
});

test('Sandbox service binding fails closed when its public photo endpoint is unavailable', async () => {
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  const source = worker.slice(worker.indexOf('const EXPERIENCE_PREVIEW_HOST_SUFFIX'),
    worker.indexOf('// ===== PHOTOS ====='));
  const ctx = {
    URL, Request, Response,
    fetch: async () => { throw new Error('must not fall back to unverified source'); },
    jsonRes: (value, status) => new Response(JSON.stringify(value), { status }),
  };
  vm.runInNewContext(source + '\nthis.previewHandler = handleExperiencePreviewPublicPhotos;', ctx);
  const response = await ctx.previewHandler({
    url: 'https://feature-amit-photos-paypal-sandbox.erez-family.workers.dev/api/experience-preview-photos',method: 'GET',
  }, { PUBLIC_GALLERY_SERVICE: { fetch: async () => new Response('unavailable', {status:503}) } });
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,'public gallery unavailable');
});

test('preview proxy returns only published rows with absolute image URLs; production fails closed', async () => {
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  const source = worker.slice(worker.indexOf('const EXPERIENCE_PREVIEW_HOST_SUFFIX'),
    worker.indexOf('// ===== PHOTOS ====='));
  const calls = [];
  const ctx = {
    URL,
    Response,
    fetch: async (...args) => {
      calls.push(args);
      return new Response(JSON.stringify([
        { id: 'public-1', published: 1, thumbnail: '/photos/thumb/one.webp', url: '/photos/one.webp' },
        { id: 'hidden-2', published: 0, thumbnail: '/photos/thumb/two.webp' },
        { id: 'hidden-3', published: false, thumbnail: '/photos/thumb/three.webp' },
      ]), { status: 200 });
    },
    jsonRes: (value, status) => new Response(JSON.stringify(value), { status }),
  };
  vm.runInNewContext(source + '\nthis.previewHandler = handleExperiencePreviewPublicPhotos;', ctx);
  const prod = await ctx.previewHandler({ url: 'https://amitphotos.com/api/experience-preview-photos', method: 'GET' });
  assert.equal(prod.status, 404);
  assert.equal(calls.length, 0);
  const preview = await ctx.previewHandler({
    url: 'https://feature-experience-analytics-story-p-amit-photos-paypal-sandbox.erez-family.workers.dev/api/experience-preview-photos',
    method: 'GET',
  });
  assert.equal(preview.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://www.amitphotos.com/api/photos');
  const rows = await preview.json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'public-1');
  assert.equal(rows[0].thumbnail, 'https://amitphotos.com/photos/thumb/one.webp');
  assert.equal(rows[0].url, 'https://amitphotos.com/photos/one.webp');
});

test('preview proxy falls back only to apex public gallery if www fails', async () => {
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  const source = worker.slice(worker.indexOf('const EXPERIENCE_PREVIEW_HOST_SUFFIX'),
    worker.indexOf('// ===== PHOTOS ====='));
  const calls = [];
  const ctx = {
    URL,
    Response,
    fetch: async (url, options) => {
      calls.push([url, options]);
      if (url === 'https://www.amitphotos.com/api/photos') {
        return new Response(null, { status: 302, headers: { location: 'https://amitphotos.com/api/photos' } });
      }
      assert.equal(url, 'https://amitphotos.com/api/photos');
      return new Response(JSON.stringify([
        { id: 'public-photo', published: 1, thumbnail: '/photos/thumb/public.webp' },
        { id: 'unpublished-photo', published: false, url: '/photos/private.webp' },
      ]), { status: 200 });
    },
    jsonRes: (value, status) => new Response(JSON.stringify(value), { status }),
  };
  vm.runInNewContext(source + '\nthis.previewHandler = handleExperiencePreviewPublicPhotos;', ctx);
  const preview = await ctx.previewHandler({
    url: 'https://feature-amit-photos-paypal-sandbox.erez-family.workers.dev/api/experience-preview-photos',
    method: 'GET',
  });
  assert.equal(preview.status, 200);
  assert.deepEqual(calls.map(v => v[0]), [
    'https://www.amitphotos.com/api/photos',
    'https://amitphotos.com/api/photos',
  ]);
  assert.ok(calls.every(v => v[1].redirect === 'error' && v[1].method === 'GET'));
  const rows = await preview.json();
  assert.deepEqual(rows.map(row => row.id), ['public-photo']);
  assert.equal(rows[0].thumbnail, 'https://amitphotos.com/photos/thumb/public.webp');
});

test('preview proxy fails closed when public source is unavailable', async () => {
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  const source = worker.slice(worker.indexOf('const EXPERIENCE_PREVIEW_HOST_SUFFIX'),
    worker.indexOf('// ===== PHOTOS ====='));
  const ctx = {
    URL,
    Response,
    fetch: async () => { throw new Error('upstream unavailable'); },
    jsonRes: (value, status) => new Response(JSON.stringify(value), { status }),
  };
  vm.runInNewContext(source + '\nthis.previewHandler = handleExperiencePreviewPublicPhotos;', ctx);
  const response = await ctx.previewHandler({
    url: 'https://e07c1d63-amit-photos-paypal-sandbox.erez-family.workers.dev/api/experience-preview-photos',
    method: 'GET',
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'public gallery unavailable');
});

test('direct links show the discovery once public content is loaded', () => {
  assert.match(gallery, /if \(available > 0 && window\.location\.hash === '#experience'\)/);
  assert.match(gallery, /requestAnimationFrame\(\(\) => section\.scrollIntoView\(\{ behavior: 'auto', block: 'start' \}\)\)/);
});

test('cards are localized and can be activated with keyboard buttons', () => {
  for (const id of ['quiet', 'wonder', 'details', 'places']) {
    assert.match(html, new RegExp('data-experience="' + id + '"'));
    assert.match(i18n, new RegExp("'experience\\." + id + "\\.title'"));
  }
  assert.match(html, /aria-controls="gallery-grid-wrap" aria-pressed="false" disabled/);
  assert.match(gallery, /function applyFilters\(\) \{\s*clearExperienceSelection\(\)/);
  assert.match(gallery, /if \(activeExperiencePath\) showExperiencePath\(activeExperiencePath, \{ track: false, scroll: false \}\)/);
  assert.match(gallery, /#experience-/);
});

test('discovery click sends anonymous path metadata only', () => {
  assert.match(gallery, /trackUxEvent\?\.\('experience_path_click', \{ label: pathId, result_count: matches\.length \}\)/);
  const source = gallery.slice(gallery.indexOf('function showExperiencePath('), gallery.indexOf('function initExperiencePaths('));
  assert.doesNotMatch(source, /email|phone|photo_title|description/);
});

test('cards have responsive columns and a hidden state', () => {
  assert.match(css, /\.experience-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.experience-card\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.experience-section\[hidden\]/);
});
