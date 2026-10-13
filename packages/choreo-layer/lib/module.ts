// The Choreo module: reads the app's PASSPORT.yml when the app builds, and
// sets the app up to match it.
//
// - Every page: the language, a default title, the base path (a Pages site
//   without a custom domain lives under /<app>/), and noindex when the passport
//   says the app isn't indexable.
// - Tailwind and the brand tokens.
// - robots.txt always, and sitemap.xml for an indexable site.
// - A container app: /health, answered without sign-in; the security guard
//   on /api (token, role and origin checks, request ids, audit lines, clean
//   errors); the auto-imported requireUser, requireRole and auditLog; and an
//   X-Robots-Tag: noindex header when it isn't indexable.
// - A build whose kind doesn't match the tier stops with an explanation.
//
// The decisions themselves are in lib/settings.js and lib/security.js, which
// the tests check.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { addServerHandler, addServerImports, addServerPlugin, addTypeTemplate, addVitePlugin, createResolver, defineNuxtModule } from '@nuxt/kit'
import tailwindcss from '@tailwindcss/vite'
import { parse } from 'yaml'
import { robotsTxt, settingsFrom, sitemapXml, staticRoutes } from './settings.js'

export default defineNuxtModule({
  meta: { name: 'choreo' },
  setup(_options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    const passportPath = join(nuxt.options.rootDir, 'PASSPORT.yml')
    if (!existsSync(passportPath)) {
      throw new Error('The Choreo layer reads PASSPORT.yml at the app\'s root, and there is none. Run create or governance, or ask Platform Engineering.')
    }
    const settings = settingsFrom(parse(readFileSync(passportPath, 'utf8')), process.env)

    // Every page. Nuxt copies app.baseURL into the runtime config and the
    // server's settings before modules run, so all three are set here.
    nuxt.options.app.baseURL = settings.baseURL
    nuxt.options.runtimeConfig.app.baseURL = settings.baseURL
    const head = nuxt.options.app.head
    head.htmlAttrs = { lang: 'en', ...head.htmlAttrs }
    head.title ||= settings.title
    if (!settings.indexable) head.meta = [...(head.meta ?? []), { name: 'robots', content: 'noindex' }]
    nuxt.options.runtimeConfig.public.choreo = { title: settings.title }

    // Tailwind and the brand tokens.
    addVitePlugin(tailwindcss())
    nuxt.options.css.push(resolve('../assets/choreo.css'))

    // robots.txt and sitemap.xml, from virtual modules filled in once the pages are known.
    let routes: string[] = []
    nuxt.hook('pages:resolved', (pages) => {
      routes = staticRoutes(pages)
    })
    nuxt.hook('nitro:config', (config) => {
      config.baseURL = settings.baseURL
      config.virtual ||= {}
      config.virtual['#choreo/robots'] = () => `export default ${JSON.stringify(robotsTxt(settings))}`
      config.virtual['#choreo/sitemap'] = () => `export default ${JSON.stringify(sitemapXml(settings.siteUrl, routes))}`
      if (settings.tier === 'pages') {
        config.prerender ||= {}
        config.prerender.routes = [...(config.prerender.routes ?? []), '/robots.txt', ...(settings.indexable ? ['/sitemap.xml'] : [])]
      }
      if (settings.tier === 'container') {
        const security = { app: settings.app, roles: settings.roles, indexable: settings.indexable, customDomain: settings.customDomain }
        config.virtual['#choreo/security'] = () => `export default ${JSON.stringify(security)}`
        // Nuxt has set its own error handler by now. Ours goes first: it
        // answers /api errors itself and passes page errors on to Nuxt's.
        const handlers = config.errorHandler === undefined ? [] : [config.errorHandler].flat()
        config.errorHandler = [resolve('../runtime/security/error'), ...handlers]
      }
    })
    addTypeTemplate({
      filename: 'types/choreo-virtual.d.ts',
      getContents: () => readFileSync(resolve('../runtime/virtual.d.ts'), 'utf8'),
    }, { nuxt: true, nitro: true })
    addServerHandler({ route: '/robots.txt', handler: resolve('../runtime/robots') })
    if (settings.indexable) addServerHandler({ route: '/sitemap.xml', handler: resolve('../runtime/sitemap') })

    // A container app.
    if (settings.tier === 'container') {
      addServerHandler({ route: '/health', handler: resolve('../runtime/health') })

      // Filled in at run time from NUXT_CHOREO_ENTRA_TENANT_ID and _CLIENT_ID,
      // which the platform sets. Empty, /api answers 503.
      nuxt.options.runtimeConfig.choreo = { entra: { tenantId: '', clientId: '' } }
      addServerHandler({ middleware: true, handler: resolve('../runtime/security/middleware') })
      addServerPlugin(resolve('../runtime/security/plugin'))
      addServerImports(['requireUser', 'requireRole', 'auditLog'].map((name) => ({ name, from: resolve('../runtime/security/utils') })))
      addTypeTemplate({
        filename: 'types/choreo-security.d.ts',
        getContents: () => [
          `import type { GuardResult, User } from ${JSON.stringify(resolve('./security.js'))}`,
          'declare global {',
          '  /** One of the Entra app roles in PASSPORT.yml. */',
          `  type ChoreoRole = ${settings.roles.map((role) => JSON.stringify(role)).join(' | ') || 'never'}`,
          '}',
          "declare module 'h3' {",
          '  interface H3EventContext {',
          '    choreo?: { requestId: string, check?: Promise<GuardResult>, user?: User, denied?: boolean }',
          '  }',
          '}',
          'export {}',
          '',
        ].join('\n'),
      }, { nuxt: true, nitro: true })
    }

    // The kind of build has to match the tier. This hook runs only for a real
    // build, not for `nuxt prepare` after an install or for `nuxt dev`.
    nuxt.hook('nitro:build:before', (nitro) => {
      if (nuxt.options.dev) return
      const generating = Boolean(nitro.options.static)
      if (settings.tier === 'pages' && !generating) {
        throw new Error('PASSPORT.yml says this is a Pages site, which builds with `nuxt generate`. Set the build script to `nuxt generate`.')
      }
      if (settings.tier === 'container' && generating) {
        throw new Error('PASSPORT.yml says this is a container app, which builds with `nuxt build`. Set the build script to `nuxt build`.')
      }
    })
  },
})
