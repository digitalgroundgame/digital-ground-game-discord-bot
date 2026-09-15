import { type Router } from 'express'

export interface Controller {
  path: string
  router: Router
  /** When true, `Api` refuses to mount the controller unless `authToken` is a non-empty string. */
  requiresAuth?: boolean
  authToken?: string
  register(): void
}
