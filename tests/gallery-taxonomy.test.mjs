import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const gallery = fs.readFileSync('assets/js/gallery.js', 'utf8');
const i18n = fs.readFileSync('assets/js/i18n.js', 'utf8');
const css = fs.readFileSync('assets/css/style.css', 'utf8');
const taxonomy = JSON.parse(fs.readFileSync('data/gallery-taxonomy.json', 'utf8'));

test('business taxonomy covers all current categories exactly once', () => {
  const primary = taxonomy.public_navigation.subject_galleries.map(x => x.category);
  const locations = taxonomy.public_navigation.locations_collection.children.map(x => x.category);
  const styles = taxonomy.public_navigation.style_filters.map(x => x.category);
  const all = [...primary, ...locations, ...styles];
  assert.equal(primary.length, 7);
  assert.equal(locations.length, 18);
  assert.equal(styles.length, 2);
  assert.equal(new Set(all).size, 27);
  assert.equal(taxonomy.covered_category_count, 27);
  assert.equal(taxonomy.total_photos, 1390);
  assert.equal(taxonomy.public_navigation.primary_destinations, 8);
});

test('Georgia is grouped under Places Around the World', () => {
  assert.match(gallery, /'הולנד','גאורגיה'/);
  assert.ok(taxonomy.public_navigation.locations_collection.children.some(x => x.category === 'גאורגיה'));
});

test('style categories are rendered separately from primary galleries', () => {
  assert.match(gallery, /const STYLE_FILTER_ORDER = \['שחור-לבן', 'צילומי לילה'\]/);
  assert.match(gallery, /filter-row-styles/);
  assert.match(gallery, /gallery\.filter\.styles/);
  assert.match(i18n, /'gallery\.filter\.styles':\s+'סגנון'/);
  assert.match(i18n, /'gallery\.filter\.styles':\s+'Style'/);
  assert.match(css, /\.filter-row-styles/);
});

test('Drive remains archive-only in taxonomy policy', () => {
  assert.equal(taxonomy.policy.drive, 'archive_master_unchanged');
  assert.equal(taxonomy.policy.delete_from_drive_automatically, false);
  assert.equal(taxonomy.policy.move_drive_files_automatically, false);
});
