import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const admin = readFileSync(fileURLToPath(new URL('../admin.html', import.meta.url)), 'utf8');

const dialogs = [...admin.matchAll(/<dialog\b[^>]*>/g)].map(match => match[0]);

test('every admin dialog has an accessible name wired with aria-labelledby', () => {
  assert.equal(dialogs.length, 8, 'update this test when a dialog is added or removed');
  for (const tag of dialogs) {
    const id = tag.match(/id="([^"]+)"/)?.[1];
    const labelId = tag.match(/aria-labelledby="([^"]+)"/)?.[1];
    assert.ok(labelId, `${id} is missing aria-labelledby`);
    assert.match(admin, new RegExp(`id="${labelId}"`), `${id} points to missing label ${labelId}`);
  }
});

test('icon-only dialog close buttons have an explicit Hebrew name', () => {
  const closeButtons = [...admin.matchAll(/<button\b[^>]*class="[^"]*(?:dialog-close|lb-close)[^"]*"[^>]*>/g)].map(match => match[0]);
  assert.equal(closeButtons.length, 8);
  for (const tag of closeButtons) assert.match(tag, /aria-label="סגור"/);
});

test('lightbox arrow controls announce previous and next photo', () => {
  assert.match(admin, /id="lb-prev"[^>]*aria-label="תמונה קודמת"/);
  assert.match(admin, /id="lb-next"[^>]*aria-label="תמונה הבאה"/);
});

test('Pinterest modal status changes are announced politely', () => {
  assert.match(admin, /id="pin-modal-status"[^>]*role="status"[^>]*aria-live="polite"/);
});
