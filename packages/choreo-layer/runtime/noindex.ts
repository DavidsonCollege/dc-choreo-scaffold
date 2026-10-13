// For a container app that isn't indexable: tells search engines not to index
// any response, alongside the noindex tag on every page.
import { defineEventHandler, setResponseHeader } from 'h3'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'X-Robots-Tag', 'noindex')
})
