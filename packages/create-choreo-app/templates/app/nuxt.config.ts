// Nuxt configuration for this Choreo app.
//
// The Choreo layer brings the Davidson header and footer, the brand tokens and
// Tailwind, the page language and title, the robots and noindex handling from
// PASSPORT.yml and, for a container app, /health and the security guard on
// /api with requireUser, requireRole and auditLog. How to use them:
// node_modules/@davidson/choreo-layer/README.md. Settings here win over the
// layer's, so leave the layer's security settings alone.
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  extends: ['@davidson/choreo-layer'],
  modules: ['@pinia/nuxt', '@nuxt/eslint'],
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
})
