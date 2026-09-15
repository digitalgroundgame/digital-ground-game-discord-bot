import { type RequestHandler } from 'express'
import { timingSafeEqual } from 'node:crypto'

function tokensMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  )
}

export function checkAuth(token: string): RequestHandler {
  return (req, res, next) => {
    const provided = req.headers.authorization
    if (!provided || !tokensMatch(provided, token)) {
      res.sendStatus(401)
      return
    }
    next()
  }
}
