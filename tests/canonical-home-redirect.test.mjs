import test from 'node:test';
import assert from 'node:assert/strict';

const { default: worker } = await import('../worker.js');

test('/index.html redirects to the canonical homepage', async () => {
  const response = await worker.fetch(new Request('https://amitphotos.com/index.html'), {}, {});

  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), 'https://amitphotos.com/');
});

test('canonical homepage redirect preserves campaign parameters', async () => {
  const response = await worker.fetch(
    new Request('https://amitphotos.com/index.html?utm_source=instagram&utm_campaign=gallery'),
    {},
    {},
  );

  assert.equal(response.status, 301);
  assert.equal(
    response.headers.get('location'),
    'https://amitphotos.com/?utm_source=instagram&utm_campaign=gallery',
  );
});

test('www plus /index.html is canonicalized in one redirect', async () => {
  const response = await worker.fetch(
    new Request('https://www.amitphotos.com/index.html?lang=en'),
    {},
    {},
  );

  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), 'https://amitphotos.com/?lang=en');
});
