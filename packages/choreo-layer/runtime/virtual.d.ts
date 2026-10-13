// Types for the virtual modules the Choreo module fills in at build time.
declare module '#choreo/robots' {
  const text: string
  export default text
}

declare module '#choreo/sitemap' {
  const xml: string
  export default xml
}

declare module '#choreo/security' {
  const security: { app: string, roles: string[], indexable: boolean, customDomain: string | null }
  export default security
}
