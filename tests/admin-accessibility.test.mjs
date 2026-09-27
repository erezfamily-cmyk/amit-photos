import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const admin = readFileSync(fileURLToPath(new URL('../admin.html', import.meta.url)), 'utf8');

test('admin authentication fields and status messages have accessible names', () => {
  assert.match(admin, /<label[^>]*for="password-input"[^>]*>[^<]+<\/label>/);
  assert.match(admin, /id="password-input"[^>]*autocomplete="current-password"/);
  assert.match(admin, /id="pwd-toggle"[^>]*aria-label="הצג סיסמה"[^>]*aria-pressed="false"/);
  assert.match(admin, /<label[^>]*for="reset-new-pwd"[^>]*>[^<]+<\/label>/);
  assert.match(admin, /<label[^>]*for="reset-confirm-pwd"[^>]*>[^<]+<\/label>/);
  assert.match(admin, /id="login-error"[^>]*role="alert"/);
  assert.match(admin, /id="forgot-success"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(admin, /id="reset-success"[^>]*role="status"[^>]*aria-live="polite"/);
});

test('mobile admin drawer exposes state and supports focus-safe dismissal', () => {
  assert.match(admin, /<aside class="sidebar" id="admin-sidebar"[^>]*aria-label="ניווט מנהל"/);
  assert.match(admin, /id="mobile-nav-toggle"[^>]*aria-controls="admin-sidebar"[^>]*aria-expanded="false"/);
  assert.match(admin, /if \(e\.key === 'Escape'[^)]*side\?\.classList\.contains\('open'\)/);
  assert.match(admin, /sidebarCloseBtn\?\.focus\(\)/, 'opening the drawer should move focus into it');
  assert.match(admin, /mobileNavToggle\?\.focus\(\)/, 'closing the drawer should restore focus to its trigger');
  assert.match(admin, /e\.key === 'Tab'[\s\S]*side\.querySelectorAll/, 'Tab focus should stay inside an open drawer');
});

test('admin section navigation is keyboard operable and announces the current page', () => {
  assert.match(admin, /item\.setAttribute\('role', 'button'\)/);
  assert.match(admin, /item\.setAttribute\('tabindex', '0'\)/);
  assert.match(admin, /e\.key === 'Enter' \|\| e\.key === ' '/);
  assert.match(admin, /setAttribute\('aria-current', 'page'\)/);
});

test('photo upload drop zone is available to keyboard users', () => {
  assert.match(admin, /id="upload-zone"[^>]*role="button"[^>]*tabindex="0"[^>]*aria-label="הוסף תמונות"/);
  assert.match(admin, /zone\.addEventListener\('keydown',[\s\S]*e\.key === 'Enter' \|\| e\.key === ' '/);
});
