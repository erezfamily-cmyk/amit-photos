import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const admin = readFileSync(fileURLToPath(new URL('../admin.html', import.meta.url)), 'utf8');

const coreFields = [
  'sub-name', 'sub-email', 'sub-notes', 'sub-search',
  'cust-search', 'cust-filter-type', 'cust-filter-status',
  'bulk-cat-select', 'new-badge-days-select',
  'edit-photo-title', 'edit-photo-category', 'edit-photo-desc', 'edit-photo-drive-id',
  'reply-to-email', 'reply-subject', 'reply-body',
  'cust-name', 'cust-email', 'cust-phone', 'cust-date', 'cust-type', 'cust-status',
  'cust-subject', 'cust-notes',
  'pin-board-select', 'pin-description',
];

test('core admin form controls have explicit label associations', () => {
  for (const id of coreFields) {
    assert.match(admin, new RegExp(`<label[^>]*for="${id}"`), `${id} has no associated label`);
    assert.match(admin, new RegExp(`<(?:input|select|textarea)[^>]*id="${id}"`), `${id} control is missing`);
  }
});

test('search and filter labels can be visually hidden without disappearing from assistive technology', () => {
  for (const id of ['sub-search', 'cust-search', 'cust-filter-type', 'cust-filter-status']) {
    assert.match(admin, new RegExp(`<label class="sr-only" for="${id}"`));
  }
});

test('reply and Pinterest asynchronous status messages are live regions', () => {
  assert.match(admin, /id="reply-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(admin, /id="pin-modal-status"[^>]*role="status"[^>]*aria-live="polite"/);
});
