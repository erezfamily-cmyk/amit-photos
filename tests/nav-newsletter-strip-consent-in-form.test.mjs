import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The subpage newsletter strip (nav.js, source=subpage_strip) had its two consent checkboxes as
// siblings AFTER </form>, not children of it. Native HTML5 required-field validation only applies
// to elements associated with the form being submitted, so the required privacy checkbox was
// never actually blocking submission in the browser — the submit handler read its .checked value
// unconditionally and always sent whatever it was. The server already rejects
// consent_privacy=false regardless of source, so this was a UX gap (confusing server error
// instead of a native "please check this box" prompt), not a compliance bypass — but still worth
// fixing so the browser's own validation does its job.
const src = readFileSync(fileURLToPath(new URL('../assets/js/nav.js', import.meta.url)), 'utf8');

test('regression: both newsletter-strip consent checkboxes are inside <form id="nav-nl-form">, not siblings after it', () => {
  const formStart = src.indexOf('<form id="nav-nl-form">');
  const formEnd = src.indexOf('</form>', formStart);
  assert.ok(formStart !== -1 && formEnd !== -1, 'nav-nl-form not found');
  const formBody = src.slice(formStart, formEnd);
  assert.match(formBody, /id="nav-nl-consent-privacy"/);
  assert.match(formBody, /id="nav-nl-consent-marketing"/);
});

test('the privacy checkbox keeps its required attribute, so native validation now actually blocks submission', () => {
  const match = src.match(/<input type="checkbox" id="nav-nl-consent-privacy"([^>]*)>/);
  assert.ok(match, 'consent-privacy checkbox not found');
  assert.match(match[1], /\brequired\b/);
});

test('the marketing checkbox stays optional (no required attribute)', () => {
  const match = src.match(/<input type="checkbox" id="nav-nl-consent-marketing"([^>]*)>/);
  assert.ok(match, 'consent-marketing checkbox not found');
  assert.doesNotMatch(match[1], /\brequired\b/);
});
