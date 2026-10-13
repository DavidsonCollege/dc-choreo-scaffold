// /health for a container app: answers that the app is running. It needs no
// sign-in and returns nothing about the app, so the platform's health probe
// and the Containerfile's HEALTHCHECK can call it.
import { defineEventHandler } from 'h3'

export default defineEventHandler(() => ({ status: 'ok' }))
