import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// User report: dragging a photo into the admin upload zone opened the tagging dialog, but the
// dialog never showed the photo itself — only the filename in the title bar and empty
// title/category/description fields. Root cause: promptPhotoMeta(filename) only ever received
// the filename string (from uploadFiles' `promptPhotoMeta(file.name)` call), never the actual
// File object, so it had no way to render a preview even if the dialog had an <img> for one —
// which it didn't. Without seeing the photo, there's no way to pick the right category or write
// an accurate title/description.
const admin = readFileSync(fileURLToPath(new URL('../admin.html', import.meta.url)), 'utf8');

function fn(name) {
  const start = admin.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found — has it moved or been renamed?`);
  let depth = 0, i = admin.indexOf('{', start);
  const bodyStart = i;
  for (; i < admin.length; i++) {
    if (admin[i] === '{') depth++;
    else if (admin[i] === '}') { depth--; if (depth === 0) break; }
  }
  return admin.slice(start, i + 1);
}

test('the photo dialog has an image preview element', () => {
  const dialogStart = admin.indexOf('<dialog id="photo-dialog"');
  const dialogEnd = admin.indexOf('</dialog>', dialogStart);
  const dialog = admin.slice(dialogStart, dialogEnd);
  assert.match(dialog, /<img id="photo-dialog-preview"/);
});

test('uploadFiles passes the actual File object to promptPhotoMeta, not just its name', () => {
  const uploadFiles = fn('uploadFiles');
  assert.match(uploadFiles, /promptPhotoMeta\(file\)/,
    'must pass the File object — promptPhotoMeta needs it to build a preview');
  assert.doesNotMatch(uploadFiles, /promptPhotoMeta\(file\.name\)/);
});

test('promptPhotoMeta renders a live preview of the dragged/selected file before asking for tags', () => {
  const body = fn('promptPhotoMeta');
  assert.match(body, /URL\.createObjectURL\(file\)/, 'must build an object URL from the actual file to preview it');
  assert.match(body, /previewImg\.src = previewUrl/);
  assert.match(body, /previewImg\.style\.display = 'block'/);
});

test('promptPhotoMeta revokes the preview object URL on close (save or cancel), preventing a leak across a multi-file upload batch', () => {
  const body = fn('promptPhotoMeta');
  const closeHandlerStart = body.indexOf("addEventListener('close'");
  assert.notEqual(closeHandlerStart, -1);
  const closeHandler = body.slice(closeHandlerStart);
  assert.match(closeHandler, /URL\.revokeObjectURL\(previewUrl\)/);
});

test('editing an existing photo also shows its preview (parity with the upload flow)', () => {
  const body = fn('openEdit');
  assert.match(body, /photo-dialog-preview/);
  assert.match(body, /p\.thumbnail \|\| p\.url/);
});
