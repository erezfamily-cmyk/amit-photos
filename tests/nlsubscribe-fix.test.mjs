import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../worker.js', import.meta.url)), 'utf8');
const nlSubscribeMatch = src.match(/async function nlSubscribe\(e\)\{.*?(?=\nfunction |\nasync function )/s);

test('nlSubscribe() function is present in worker.js', () => {
  assert.ok(nlSubscribeMatch, 'nlSubscribe function not found');
});

test('nlSubscribe() no longer silently sends {email} only — reads real checkbox state', () => {
  const fn = nlSubscribeMatch[0];
  assert.match(fn, /document\.getElementById\('nl-consent-privacy'\)\.checked/);
  assert.match(fn, /document\.getElementById\('nl-consent-marketing'\)\.checked/);
  // the old bug: JSON.stringify({email}) with nothing else
  assert.doesNotMatch(fn, /JSON\.stringify\(\{email\}\)/);
});

test('nlSubscribe() blocks submission client-side when either checkbox is unchecked (no fetch attempt)', () => {
  const fn = nlSubscribeMatch[0];
  assert.match(fn, /if\(!consentPrivacy\|\|!consentMarketing\)/);
});

test('nlSubscribe() posts source=newsletter_issue, not the unlisted "website" default', () => {
  const fn = nlSubscribeMatch[0];
  assert.match(fn, /source=newsletter_issue/);
});

test('the rendered form markup has both consent checkboxes, both required', () => {
  assert.match(src, /id="nl-consent-privacy" required/);
  assert.match(src, /id="nl-consent-marketing" required/);
});

test('the privacy checkbox links to the real privacy policy page', () => {
  const formSection = src.slice(src.indexOf('nl-subscribe-card">'), src.indexOf('nl-subscribe-card">') + 2000);
  assert.match(formSection, /href="\/privacy\/"/);
});
