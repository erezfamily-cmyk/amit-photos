import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Chrome's own accessibility audit flagged "No label associated with a form field" live on the
// homepage. Several inputs (buy-modal email, print-modal shipping fields, homepage newsletter
// email) relied solely on data-i18n-aria, which i18n.js's applyTranslations() only sets on
// DOMContentLoaded — leaving the field genuinely unlabeled until that JS runs. Every one of
// these now also carries a static aria-label matching the current (Hebrew) placeholder, so the
// field is labeled from first paint; the JS still updates it on language switch.
const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

test('every input with data-i18n-aria also has a static aria-label (labeled before JS runs, not only after)', () => {
  const inputTags = html.match(/<input\b[^>]*data-i18n-aria="[^"]*"[^>]*>/g) || [];
  assert.ok(inputTags.length > 0, 'expected to find at least one data-i18n-aria input to check');
  const unlabeled = inputTags.filter(tag => !/\baria-label=/.test(tag));
  assert.deepEqual(unlabeled, [], `these inputs have data-i18n-aria but no static aria-label: ${unlabeled.join('\n')}`);
});

test('the web3forms honeypot field is hidden from assistive tech and keyboard tabbing, not just visually', () => {
  // it's intentionally unlabeled (a real label would tip off screen-reader users to the trap,
  // defeating its purpose) — the fix is removing it from the accessibility tree and tab order
  // entirely, which is also what silences Chrome's "no label associated" audit for it.
  const match = html.match(/<input name="botcheck"[^>]*>/);
  assert.ok(match, 'botcheck honeypot field not found');
  assert.match(match[0], /aria-hidden="true"/);
  assert.match(match[0], /tabindex="-1"/);
});
