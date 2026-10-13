// Types for lib/settings.js, which is plain JavaScript so its tests run with
// node --test. Keep these in step with the JSDoc there.
export interface Settings {
  app: string
  tier: 'pages' | 'container'
  indexable: boolean
  title: string
  baseURL: string
  siteUrl: string | null
}

export function settingsFrom(passport: Record<string, any>, env?: Record<string, string | undefined>): Settings
export function titleFrom(app: string): string
export function robotsTxt(settings: Settings): string
export function sitemapXml(siteUrl: string | null, routes: string[]): string
export function staticRoutes(pages: { path: string, children?: any[] }[], parent?: string): string[]
