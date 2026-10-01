import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const PROD_D1_ID = '802379c7-97cf-4262-93b8-da81c5c3c07d';

test('production payments remain fail-closed', async () => {
  const wrangler = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(wrangler, /PAYMENTS_ENABLED\s*=\s*"false"/);
  assert.doesNotMatch(wrangler, /PAYMENTS_ENABLED\s*=\s*"true"/);
});

test('PayPal sandbox staging config is isolated from production resources', async () => {
  const staging = await readFile(new URL('../wrangler.paypal-sandbox.example.toml', import.meta.url), 'utf8');

  assert.match(staging, /name\s*=\s*"amit-photos-paypal-sandbox"/);
  assert.match(staging, /database_name\s*=\s*"amit-photos-paypal-sandbox-db"/);
  assert.match(staging, /bucket_name\s*=\s*"amit-photos-paypal-sandbox-images"/);
  assert.match(staging, /database_id\s*=\s*"__STAGING_D1_DATABASE_ID__"/);

  assert.equal(staging.includes(PROD_D1_ID), false);
  assert.equal(staging.includes('database_name = "amit-photos-db"'), false);
  assert.equal(staging.includes('bucket_name = "amit-photos-images"'), false);
  assert.equal(/amitphotos\.com/i.test(staging), false);
  const activeLines = staging
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

  assert.equal(activeLines.includes('[[routes]]'), false);
  assert.equal(activeLines.includes('[triggers]'), false);
});

test('staging bootstrap cannot silently reference production resources', async () => {
  const bootstrap = await readFile(new URL('../staging/paypal-sandbox-bootstrap.sql', import.meta.url), 'utf8');
  assert.match(bootstrap, /NEVER RUN AGAINST amit-photos-db/);
  assert.equal(bootstrap.includes(PROD_D1_ID), false);
  assert.equal(bootstrap.includes('amit-photos-images'), false);
});
