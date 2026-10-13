import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROD_D1_ID = '802379c7-97cf-4262-93b8-da81c5c3c07d';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('native Previews explicitly bind Sandbox storage and disable public payments', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'paypal-preview-'));
  try {
    const output = join(temp, 'wrangler.json');
    const result = spawnSync('python3', [join(ROOT, 'src/build_paypal_sandbox_config.py'),
      '--database-id', '11111111-1111-4111-8111-111111111111', '--preview', '--output', output],
      { cwd: temp, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(config.name, 'amit-photos-paypal-sandbox');
    // Top-level (non-Preview) vars must also keep public checkout closed.
    assert.equal(config.vars.PAYMENTS_ENABLED, 'false');
    assert.equal(config.vars.DIGITAL_PAYPAL_ENABLED, 'false');
    assert.deepEqual(config.previews.vars, {
      PAYMENTS_ENABLED: 'false',
      DIGITAL_PAYPAL_ENABLED: 'false',
      PAYPAL_SANDBOX_CLEANUP_ENABLED: 'true',
    });
    assert.deepEqual(config.previews.d1_databases, config.d1_databases);
    assert.deepEqual(config.previews.r2_buckets, config.r2_buckets);
    assert.deepEqual(config.previews.images, config.images);
    assert.equal(config.previews.assets, undefined);
    assert.equal(config.previews.routes, undefined);
    assert.equal(config.previews.triggers, undefined);
    assert.equal(config.assets.directory, ROOT);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('temporary Sandbox config resolves code and assets to the repository', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'paypal-config-'));
  try {
    const output = join(temp, 'wrangler.json');
    const result = spawnSync('python3', [join(ROOT, 'src/build_paypal_sandbox_config.py'),
      '--database-id', '11111111-1111-4111-8111-111111111111', '--output', output],
      { cwd: temp, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(config.main, join(ROOT, 'worker.js'));
    assert.equal(config.assets.directory, ROOT);
    assert.equal(config.name, 'amit-photos-paypal-sandbox');
    // The manual-workflow config deploys top-level vars; it must not open checkout.
    assert.equal(config.vars.PAYMENTS_ENABLED, 'false');
    assert.equal(config.vars.DIGITAL_PAYPAL_ENABLED, 'false');
    assert.equal(config.d1_databases[0].database_id, '11111111-1111-4111-8111-111111111111');
    assert.equal(config.d1_databases[0].database_name, 'amit-photos-paypal-sandbox-db');
    assert.equal(config.r2_buckets[0].bucket_name, 'amit-photos-paypal-sandbox-images');
    assert.equal(config.routes, undefined);
    assert.equal(config.triggers, undefined);
    assert.equal(config.previews, undefined);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

for (const databaseId of [PROD_D1_ID.toUpperCase(), 'invalid;database-id']) {
  test(`Sandbox generator rejects unsafe database input: ${databaseId}`, async () => {
    const temp = await mkdtemp(join(tmpdir(), 'paypal-config-'));
    try {
      const output = join(temp, 'wrangler.json');
      const result = spawnSync('python3', [join(ROOT, 'src/build_paypal_sandbox_config.py'),
        '--database-id', databaseId, '--output', output], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      await assert.rejects(readFile(output), { code: 'ENOENT' });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
}

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

test('Sandbox config template keeps public payments closed by default', async () => {
  const staging = await readFile(new URL('../wrangler.paypal-sandbox.example.toml', import.meta.url), 'utf8');
  const activeLines = staging
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  const flagLines = activeLines.filter(line => line.includes('PAYMENTS_ENABLED'));

  assert.equal(flagLines.length, 1);
  assert.match(flagLines[0], /^PAYMENTS_ENABLED *= *"false"$/);
  assert.doesNotMatch(staging, /PAYMENTS_ENABLED *= *"true"/);
});

test('manual Sandbox workflow cannot override the payment flag to true', async () => {
  const workflow = await readFile(new URL('../.github/workflows/paypal-sandbox-staging.yml', import.meta.url), 'utf8');
  const flagLines = workflow.split('\n').map(line => line.trim()).filter(line => line.includes('PAYMENTS_ENABLED'));

  // The only mention is the guard that asserts production stays "false".
  assert.deepEqual(flagLines, ['grep -q \'PAYMENTS_ENABLED = "false"\' wrangler.toml']);
  assert.equal(workflow.includes('--var'), false);
  assert.equal(workflow.includes('--define'), false);
  assert.equal(/PAYMENTS_ENABLED *[=:] *"?true/.test(workflow), false);
  // It deploys only the generated ephemeral config, never the production wrangler.toml.
  assert.match(workflow, /wrangler@4\.4\.0 deploy --config "\$RUNNER_TEMP\/wrangler\.paypal-sandbox\.json"/);
});

test('staging bootstrap cannot silently reference production resources', async () => {
  const bootstrap = await readFile(new URL('../staging/paypal-sandbox-bootstrap.sql', import.meta.url), 'utf8');
  assert.match(bootstrap, /NEVER RUN AGAINST amit-photos-db/);
  assert.equal(bootstrap.includes(PROD_D1_ID), false);
  assert.equal(bootstrap.includes('amit-photos-images'), false);
});
