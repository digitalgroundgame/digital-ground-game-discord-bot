import { and, eq } from 'drizzle-orm'

import { type Database } from '../database/index.js'
import {
  type AccountProvider,
  type LinkedAccount,
  linkedAccount,
  user,
} from '../database/schema.js'
import { Logger } from './logger.js'

/** Fields captured from an external account when it is linked. */
export interface LinkAccountInput {
  externalId: string
  email?: string
  displayName?: string
}

/**
 * Manages Discord members and the external accounts (Google, etc.) they have
 * verified through OAuth sign-in flows such as `/google-add`.
 */
export class UserService {
  constructor(private db: Database) {}

  /**
   * Link (or refresh) an external account for a Discord user. Ensures the
   * `user` row exists, then upserts the `linked_account` row keyed on
   * (discordUserId, provider) so re-linking updates rather than duplicates.
   */
  public async linkAccount(
    discordUserId: string,
    provider: AccountProvider,
    account: LinkAccountInput,
  ): Promise<void> {
    const now = new Date()
    await this.db.transaction(async (tx) => {
      await tx
        .insert(user)
        .values({ discordUserId, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: user.discordUserId, set: { updatedAt: now } })

      await tx
        .insert(linkedAccount)
        .values({
          discordUserId,
          provider,
          externalId: account.externalId,
          email: account.email,
          displayName: account.displayName,
          linkedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [linkedAccount.discordUserId, linkedAccount.provider],
          set: {
            externalId: account.externalId,
            email: account.email,
            displayName: account.displayName,
            linkedAt: now,
            updatedAt: now,
          },
        })
    })
    Logger.info(`User link: ${discordUserId} → ${provider} (${account.email ?? account.externalId})`)
  }

  /** Convenience wrapper for the Google provider. */
  public async linkGoogleAccount(
    discordUserId: string,
    googleEmail: string,
    googleSubject: string,
  ): Promise<void> {
    await this.linkAccount(discordUserId, 'google', {
      externalId: googleSubject,
      email: googleEmail,
    })
  }

  /** Look up a Discord user's linked account for a given provider, if any. */
  public async findLinkedAccount(
    discordUserId: string,
    provider: AccountProvider,
  ): Promise<LinkedAccount | undefined> {
    return this.db.query.linkedAccount.findFirst({
      where: and(
        eq(linkedAccount.discordUserId, discordUserId),
        eq(linkedAccount.provider, provider),
      ),
    })
  }
}
