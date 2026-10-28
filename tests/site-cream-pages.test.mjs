import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = read('assets/css/guide-cream.css');
const hash = createHash('md5').update(css.replace(/\r\n/g, '\n')).digest('hex').slice(0, 8);
// standalone pages moved to the cream shell (guides and /locations/ have their own tests)
const pages = ['learn/index.html', 'gear/index.html', 'videos/index.html', '404.html'];

test('cream pages link the shared stylesheet with its current cache-bust hash', () => {
  for (const page of pages) assert.ok(read(page).includes(`/assets/css/guide-cream.css?v=${hash}`), `${page} must link guide-cream.css?v=${hash}`);
});

test('cream pages use the cream tokens, the heading font and no dark-theme colours', () => {
  for (const page of pages) {
    const html = read(page).replace(/<link rel="icon"[^>]*>/, '');
    assert.match(html, /--bg:\s*#f5f1e9/, `${page} sets the cream background token`);
    assert.ok(html.includes('family=Frank+Ruhl+Libre'), `${page} loads Frank Ruhl Libre`);
    assert.ok(!/font-family:\s*'Syne'/.test(html), `${page} still sets Syne on headings`);
    const dark = html.match(/#(0a0a0a|111|181818|1a1a1a|c8a96e|f0ede8|e0c080)\b/gi) || [];
    assert.deepEqual(dark, [], `${page} still hard-codes dark-theme colours: ${dark.join(' ')}`);
  }
});

test('cream pages carry no emoji in their markup', () => {
  for (const page of pages) {
    const found = read(page).match(/\p{Extended_Pictographic}|⃣/gu) || [];
    assert.deepEqual(found, [], `${page} still contains emoji: ${found.join('')}`);
  }
});

test('worker-rendered /learn/ and /learn/{id} link the cream shell, use cream tokens and keep the diagram card dark', () => {
  const worker = read('worker.js');
  const start = worker.indexOf('async function handleLearnIndex');
  const end = worker.indexOf('// ===== LOCATIONS API =====');
  const learn = worker.slice(start, end);
  assert.equal(learn.split(`/assets/css/guide-cream.css?v=${hash}`).length - 1, 2, 'both learn templates link guide-cream.css');
  assert.equal(learn.split('--bg:#f5f1e9').length - 1, 2, 'both learn templates set the cream tokens');
  assert.ok(!learn.includes("font-family:'Syne'"), 'no Syne headings left in the learn templates');
  assert.ok(learn.includes('class="bokeh-box guide-dark"'), 'the physics diagram stays a dark card');
  const visible = learn.split('\n').filter((l) => !/^\s*<meta /.test(l)).join('\n');
  assert.deepEqual(visible.match(/\p{Extended_Pictographic}/gu) || [], [], 'no emoji in the learn templates (og: meta tags excepted)');
});
