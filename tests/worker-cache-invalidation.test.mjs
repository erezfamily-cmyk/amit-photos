import test from 'node:test';
import assert from 'node:assert/strict';
import { invalidatePublicPhotosCache } from '../worker.js';

test('deletes /api/photos and /data/photos.json from caches.default when it exists', async () => {
  const deleted = [];
  globalThis.caches = { default: { delete: async (req) => { deleted.push(req.url || req); return true; } } };
  try {
    await invalidatePublicPhotosCache('https://amitphotos.com');
    assert.deepEqual(deleted.sort(), [
      'https://amitphotos.com/api/photos',
      'https://amitphotos.com/data/photos.json',
    ]);
  } finally {
    delete globalThis.caches;
  }
});

test('is a safe no-op when caches.default is not available (e.g. local/dry-run)', async () => {
  delete globalThis.caches;
  await assert.doesNotReject(() => invalidatePublicPhotosCache('https://amitphotos.com'));
});
