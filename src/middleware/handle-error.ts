import { type ErrorRequestHandler } from 'express'
import { createRequire } from 'node:module'

import { Logger } from '../services/index.js'

const require = createRequire(import.meta.url)
const Logs = require('../../lang/logs.json')

export function handleError(): ErrorRequestHandler {
  return (error, req, res, _next) => {
    Logger.error(
      Logs.error.apiRequest.replaceAll('{HTTP_METHOD}', req.method).replaceAll('{URL}', req.url),
      error,
    )
    // `express.json()` rejects a malformed or oversized body with a 4xx status before any
    // controller runs. Answering 500 there tells a retrying caller to retry a request that
    // can never succeed.
    const status = error.status || error.statusCode
    const clientError = typeof status === 'number' && status >= 400 && status < 500

    res.status(clientError ? status : 500).json({ error: true, message: error.message })
  }
}
