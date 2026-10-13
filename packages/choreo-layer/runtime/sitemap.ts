// /sitemap.xml for an indexable site, written by the Choreo module from the
// app's pages (lib/settings.js).
import { defineEventHandler, setResponseHeader } from 'h3'
import xml from '#choreo/sitemap'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  return xml
})
