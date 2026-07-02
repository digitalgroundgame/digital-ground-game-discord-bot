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
 * linked via the `/link-account` command.
 */
export class UserService {
  constructor(private readonly db: Database) {}

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
    this.db.transaction((tx) => {
      tx.insert(user)
        .values({ discordUserId, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: user.discordUserId, set: { updatedAt: now } })
        .run()

      tx.insert(linkedAccount)
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
        .run()
    })
    Logger.info(
      `User link: ${discordUserId} → ${provider} (${account.email ?? account.externalId})`,
    )
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

  /** All external accounts a Discord user has linked, across every provider. */
  public async listLinkedAccounts(discordUserId: string): Promise<LinkedAccount[]> {
    return this.db.query.linkedAccount.findMany({
      where: eq(linkedAccount.discordUserId, discordUserId),
    })
  }
}
