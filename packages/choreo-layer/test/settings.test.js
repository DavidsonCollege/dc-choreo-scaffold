// Tests for lib/settings.js: what the layer does for an app, from its passport.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { robotsTxt, settingsFrom, sitemapXml, staticRoutes, titleFrom } from '../lib/settings.js';

const pages = { app: 'office-hours', profile: { tier: 'pages' }, indexable: true, custom_domain: null };
const container = { app: 'advising-bookings', profile: { tier: 'container' }, indexable: false, custom_domain: null };

test('a Pages site without a custom domain lives under /<app>/ on davidsonchoreo.github.io', () => {
  const s = settingsFrom(pages);
  assert.equal(s.baseURL, '/office-hours/');
  assert.equal(s.siteUrl, 'https://davidsonchoreo.github.io/office-hours/');
});

test('a custom domain puts the site at the root', () => {
  const s = settingsFrom({ ...pages, custom_domain: 'hours.davidson.edu' });
  assert.equal(s.baseURL, '/');
  assert.equal(s.siteUrl, 'https://hours.davidson.edu/');
});

test('a container app is served at the root, with no known address without a custom domain', () => {
  const s = settingsFrom(container);
  assert.equal(s.baseURL, '/');
  assert.equal(s.siteUrl, null);
  assert.equal(s.indexable, false);
});

test('NUXT_APP_BASE_URL overrides the base path', () => {
  assert.equal(settingsFrom(pages, { NUXT_APP_BASE_URL: '/' }).baseURL, '/');
});

test('only indexable: true counts as indexable', () => {
  assert.equal(settingsFrom({ ...pages, indexable: 'true' }).indexable, false);
});

test('a passport without an app name or tier stops the build with a reason', () => {
  assert.throws(() => settingsFrom({ profile: { tier: 'pages' } }), /no `app` name/);
  assert.throws(() => settingsFrom({ app: 'x', profile: { tier: 'swa' } }), /no `profile.tier`/);
});

test('the title reads like words', () => {
  assert.equal(titleFrom('advising-bookings'), 'Advising bookings');
  assert.equal(titleFrom('hours'), 'Hours');
});

test('robots.txt always allows crawling and never blocks the whole site', () => {
  for (const passport of [pages, container, { ...pages, indexable: false }]) {
    const text = robotsTxt(settingsFrom(passport));
    assert.match(text, /^User-agent: \*\nAllow: \/\n/);
    assert.doesNotMatch(text, /^Disallow: \/$/m);
  }
});

test('robots.txt points an indexable site to its sitemap', () => {
  assert.match(robotsTxt(settingsFrom(pages)), /^Sitemap: https:\/\/davidsonchoreo\.github\.io\/office-hours\/sitemap\.xml$/m);
  assert.doesNotMatch(robotsTxt(settingsFrom(container)), /Sitemap:/);
});

test('the sitemap lists full addresses', () => {
  const xml = sitemapXml('https://davidsonchoreo.github.io/office-hours/', ['/', '/faq']);
  assert.match(xml, /<loc>https:\/\/davidsonchoreo\.github\.io\/office-hours\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/davidsonchoreo\.github\.io\/office-hours\/faq<\/loc>/);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
});

test('pages with a parameter are left out of the sitemap', () => {
  const routes = staticRoutes([
    { path: '/' },
    { path: '/faq' },
    { path: '/people/:id()' },
    { path: '/guides', children: [{ path: 'start' }, { path: ':slug' }] },
  ]);
  assert.deepEqual(routes, ['/', '/faq', '/guides', '/guides/start']);
});

test("the passport's roles and custom domain are carried through", () => {
  const s = settingsFrom({ ...container, roles: ['viewer', 'registrar'], custom_domain: 'bookings.davidson.edu' });
  assert.deepEqual(s.roles, ['viewer', 'registrar']);
  assert.equal(s.customDomain, 'bookings.davidson.edu');
  assert.deepEqual(settingsFrom(pages).roles, []);
  assert.equal(settingsFrom(pages).customDomain, null);
});
