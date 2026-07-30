import { type AccountProvider } from '../../database/schema.js'
import { type DiscoveredRole } from '../../services/index.js'

/** An access grant (from `/grant-access`) recorded against a linked account. */
export interface AccessGrantInfo {
  /** `/grant-access` team shortname. */
  team: string
  /** Provider resource the account was added to (for Google, the Group email). */
  groupAddress: string
  grantedAt: string
}

/** A DB-backed external account (from `/link-account`) the member has linked. */
export interface LinkedAccess {
  provider: AccountProvider
  username: string
  displayName: string | null
  linkedAt: string
  /** Teams this account has been granted access to, as recorded by the bot. */
  grants: AccessGrantInfo[]
}

export interface GetUserResponse {
  userId: string
  username: string
  displayName: string
  /**
   * CDN URL of the member's profile photo: the guild-specific (per-server) avatar
   * if set, else the global account avatar, else null. Null (rather than Discord's
   * default silhouette) so consumers can fall back to their own initials avatar.
   */
  avatarUrl: string | null
  joinedAt: string | null
  roles: DiscoveredRole[]
  access: LinkedAccess[]
}
