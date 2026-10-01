import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCampaignUrl,
  cleanToken,
  containsObviousPii,
} from '../assets/js/admin-campaign-links.mjs';

test('cleanToken normalizes campaign fields', () => {
  assert.equal(cleanToken(' 2026 OCT / Free Guide! '), '2026_oct_free_guide');
  assert.equal(cleanToken('story-1_OK'), 'story-1_ok');
});

test('buildCampaignUrl creates an amitphotos deep link with UTMs', () => {
  const url = new URL(buildCampaignUrl({
    destination: '/free-guide/',
    source: 'instagram',
    medium: 'social',
    campaign: '202610_freeguide_photo_tips',
    content: 'story_1',
  }));
  assert.equal(url.origin, 'https://amitphotos.com');
  assert.equal(url.pathname, '/free-guide/');
  assert.equal(url.searchParams.get('utm_source'), 'instagram');
  assert.equal(url.searchParams.get('utm_medium'), 'social');
  assert.equal(url.searchParams.get('utm_campaign'), '202610_freeguide_photo_tips');
  assert.equal(url.searchParams.get('utm_content'), 'story_1');
});

test('buildCampaignUrl keeps the gallery hash and adds query params before it', () => {
  const url = new URL(buildCampaignUrl({
    destination: '/#gallery',
    source: 'facebook',
    medium: 'social',
    campaign: '202610_gallery',
  }));
  assert.equal(url.pathname, '/');
  assert.equal(url.hash, '#gallery');
  assert.equal(url.searchParams.get('utm_campaign'), '202610_gallery');
});

test('rejects destinations, sources and mediums outside the allowlists', () => {
  assert.throws(() => buildCampaignUrl({
    destination: 'https://evil.example/',
    source: 'instagram',
    medium: 'social',
    campaign: 'safe',
  }), /invalid_destination/);

  assert.throws(() => buildCampaignUrl({
    destination: '/free-guide/',
    source: 'unknown',
    medium: 'social',
    campaign: 'safe',
  }), /invalid_source/);

  assert.throws(() => buildCampaignUrl({
    destination: '/free-guide/',
    source: 'instagram',
    medium: 'cpc',
    campaign: 'safe',
  }), /invalid_medium/);
});

test('rejects obvious PII before normalization can hide it', () => {
  assert.equal(containsObviousPii('name@example.com'), true);
  assert.equal(containsObviousPii('+972-50-123-4567'), true);
  assert.equal(containsObviousPii('050-123-4567'), true);
  assert.throws(() => buildCampaignUrl({
    destination: '/business/',
    source: 'linkedin',
    medium: 'social',
    campaign: 'client-name@example.com',
  }), /possible_pii/);
});

test('requires a non-empty campaign name', () => {
  assert.throws(() => buildCampaignUrl({
    destination: '/free-guide/',
    source: 'instagram',
    medium: 'social',
    campaign: ' !!! ',
  }), /missing_campaign/);
});
