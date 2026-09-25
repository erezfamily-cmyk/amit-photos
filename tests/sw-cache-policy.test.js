const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldUseNetworkFirst } = require('../sw.js');

test('network-first: /api/photos (D1-backed, admin can change it any time)', () => {
  assert.equal(shouldUseNetworkFirst('/api/photos'), true);
});

test('network-first: any other /api/ path', () => {
  assert.equal(shouldUseNetworkFirst('/api/videos'), true);
  assert.equal(shouldUseNetworkFirst('/api/print/webhook'), true);
  assert.equal(shouldUseNetworkFirst('/api/admin/photos/import'), true);
});

test('network-first: data/photos.json', () => {
  assert.equal(shouldUseNetworkFirst('/data/photos.json'), true);
});

test('cache-first: static JS/CSS bundles', () => {
  assert.equal(shouldUseNetworkFirst('/assets/js/gallery.js'), false);
  assert.equal(shouldUseNetworkFirst('/assets/css/style.css'), false);
});

test('cache-first: images are not routed through /api/ or photos.json', () => {
  assert.equal(shouldUseNetworkFirst('/photos/abc123.webp'), false);
});
