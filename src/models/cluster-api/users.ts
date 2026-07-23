import { type AccountProvider } from '../../database/schema.js'
import { type DiscoveredRole } from '../../services/index.js'

/** A DB-backed external account (from `/link-account`) the member has linked. */
export interface LinkedAccess {
  provider: AccountProvider
  username: string
  displayName: string | null
  linkedAt: string
}

export interface GetUserResponse {
  userId: string
  username: string
  displayName: string
  joinedAt: string | null
  roles: DiscoveredRole[]
  access: LinkedAccess[]
}
