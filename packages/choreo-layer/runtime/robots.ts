// /robots.txt, written by the Choreo module from the passport (lib/settings.js).
import { defineEventHandler, setResponseHeader } from 'h3'
import text from '#choreo/robots'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  return text
})
