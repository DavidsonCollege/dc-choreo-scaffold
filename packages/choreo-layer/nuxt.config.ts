// The Choreo layer's Nuxt configuration. An app uses it with
// `extends: ['@davidson/choreo-layer']`.
//
// Everything that depends on the app's passport happens in the Choreo module,
// registered here by its full path: paths in a layer's config are read from
// the app's folder, not the layer's. It lives in lib/, not modules/, because
// Nuxt loads every file in a layer's modules/ folder as a module of its own.
// The header and footer components in app/components are picked up from the
// layer automatically.
import { fileURLToPath } from 'node:url'

// A plain object rather than defineNuxtConfig(), which the layer can't import
// without depending on nuxt itself.
export default {
  modules: [fileURLToPath(new URL('./lib/module.ts', import.meta.url))],
}
