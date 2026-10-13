// @ts-check
// What the Choreo layer does for an app, worked out from its passport. Plain
// JavaScript with no Nuxt in it, so the tests can check it directly; the Nuxt
// module (lib/module.ts) applies it.
//
// Input: the parsed PASSPORT.yml, the environment, and the app's pages.
// Output: the page title, base path and site address; robots.txt; sitemap.xml.

// Where a Pages site without a custom domain is published: each app repository
// in the DavidsonChoreo organization publishes its own site.
const PAGES_ORIGIN = 'https://davidsonchoreo.github.io';

/**
 * @typedef {object} Settings
 * @property {string} app The app's name.
 * @property {'pages' | 'container'} tier The hosting tier.
 * @property {boolean} indexable Whether search engines may index the app.
 * @property {string} title The default page title.
 * @property {string} baseURL The path the site is served under, such as /my-app/.
 * @property {string | null} siteUrl The site's full address, or null when it isn't known.
 */

/**
 * Works out the layer's settings from the passport.
 *
 * @param {Record<string, any>} passport The parsed PASSPORT.yml.
 * @param {Record<string, string | undefined>} env The environment. NUXT_APP_BASE_URL overrides the base path.
 * @returns {Settings} The settings.
 * @throws {Error} When the passport has no app name or no recognized tier.
 */
export function settingsFrom(passport, env = {}) {
  const app = passport?.app;
  const tier = passport?.profile?.tier;
  if (typeof app !== 'string' || !app) throw new Error('PASSPORT.yml has no `app` name, which the Choreo layer needs. Fix the passport first.');
  if (tier !== 'pages' && tier !== 'container') throw new Error('PASSPORT.yml has no `profile.tier` of pages or container, which the Choreo layer needs. Fix the passport first.');

  const customDomain = typeof passport.custom_domain === 'string' && passport.custom_domain ? passport.custom_domain : null;
  const onPagesDomain = tier === 'pages' && !customDomain;

  let siteUrl = null;
  if (customDomain) siteUrl = `https://${customDomain}/`;
  else if (onPagesDomain) siteUrl = `${PAGES_ORIGIN}/${app}/`;

  return {
    app,
    tier,
    indexable: passport.indexable === true,
    title: titleFrom(app),
    baseURL: env.NUXT_APP_BASE_URL || (onPagesDomain ? `/${app}/` : '/'),
    siteUrl,
  };
}

/**
 * A readable title from an app name: "advising-bookings" becomes "Advising bookings".
 *
 * @param {string} app The app's name.
 * @returns {string} The title.
 */
export function titleFrom(app) {
  const words = app.split('-').filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The text of robots.txt. It always allows crawling: a site that shouldn't be
 * indexed says so with noindex on every page, and a crawler that's blocked
 * can't read the noindex. An indexable site with a known address also points
 * to its sitemap.
 *
 * @param {Settings} settings The layer's settings.
 * @returns {string} robots.txt.
 */
export function robotsTxt(settings) {
  const lines = ['User-agent: *', 'Allow: /'];
  if (settings.indexable && settings.siteUrl) lines.push(`Sitemap: ${settings.siteUrl}sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

/**
 * The text of sitemap.xml: one entry per page that has a fixed address.
 *
 * @param {string | null} siteUrl The site's full address, ending in a slash.
 * @param {string[]} routes The pages' paths, such as / and /about.
 * @returns {string} sitemap.xml.
 */
export function sitemapXml(siteUrl, routes) {
  const base = siteUrl ?? '/';
  const entries = routes.map((route) => `  <url><loc>${escapeXml(base + route.replace(/^\//, ''))}</loc></url>`);
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...entries, '</urlset>', ''].join('\n');
}

/**
 * The paths of pages with a fixed address, from Nuxt's page list. Pages with a
 * parameter, such as /people/:id, are left out, since there's no single address
 * to list.
 *
 * @param {{ path: string, children?: any[] }[]} pages Nuxt's resolved pages.
 * @param {string} [parent] The path of the parent page.
 * @returns {string[]} The paths, sorted.
 */
export function staticRoutes(pages, parent = '') {
  /** @type {string[]} */
  const routes = [];
  for (const page of pages) {
    const path = page.path.startsWith('/') ? page.path : `${parent.replace(/\/$/, '')}/${page.path}`;
    if (!path.includes(':') && !path.includes('*')) routes.push(path || '/');
    if (page.children?.length) routes.push(...staticRoutes(page.children, path));
  }
  return [...new Set(routes)].sort();
}

/**
 * Escapes text for XML.
 *
 * @param {string} text The text.
 * @returns {string} The escaped text.
 */
function escapeXml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
}
