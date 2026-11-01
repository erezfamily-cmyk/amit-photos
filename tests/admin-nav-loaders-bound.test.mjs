import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Regression (1.11.2026): bootstrapAdminNav marks every .nav-item with data-nav-bootstrap-bound, and the main
// nav handler (the one that calls loadLearn/_loadLocationsList/Purchases.load/...) used the SAME flag as its
// "already bound" guard, so it never bound. Tabs opened empty.
const admin = readFileSync(fileURLToPath(new URL('../admin.html', import.meta.url)), 'utf8');

test('main nav handler is guarded by its own flag, not the bootstrap one', () => {
  const i = admin.indexOf("if (item.dataset.section === 'learn') { learnDedup()");
  assert.ok(i > 0, 'main nav handler with per-section loaders exists');
  const loopStart = admin.lastIndexOf("document.querySelectorAll('.nav-item').forEach(item => {", i);
  const head = admin.slice(loopStart, i);
  assert.doesNotMatch(head, /navBootstrapBound\s*===\s*'1'\)\s*return/, 'must not bail on the bootstrap flag');
  assert.match(head, /navLoadersBound/);
});
