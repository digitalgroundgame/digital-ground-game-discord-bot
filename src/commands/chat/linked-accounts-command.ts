import { type ChatInputCommandInteraction, GuildMember, type PermissionsString } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import { CoordinatorRoleIds, LinkableAccounts } from '../../constants/index.js'
import { type LinkedAccount } from '../../database/schema.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { Lang, Logger, type UserService } from '../../services/index.js'
import { InteractionUtils, RoleUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

/**
 * One line per linked account, in the order `/link-account` offers the
 * services, e.g. "**Google**: `you@example.com` (linked 3 days ago)".
 */
export function formatLinkedAccounts(accounts: LinkedAccount[], data: EventData): string {
  const position = (provider: string): number => {
    const index = LinkableAccounts.findIndex((account) => account.provider === provider)
    return index === -1 ? LinkableAccounts.length : index
  }
  return [...accounts]
    .sort((a, b) => position(a.provider) - position(b.provider))
    .map((account) =>
      Lang.getRef('linkedAccounts.line', data.lang, {
        SERVICE:
          LinkableAccounts.find((linkable) => linkable.provider === account.provider)?.label ??
          account.provider,
        IDENTIFIER: account.email ?? account.externalId,
        LINKED_AT: `<t:${Math.floor(account.linkedAt.getTime() / 1000)}:R>`,
      }),
    )
    .join('\n')
}

/**
 * Shows the external accounts (Google email, GitHub username) a member has
 * linked via `/link-account`.
 *
 * Linked emails are private, so looking up another member is coordinator-only
 * (the same roles that can link on someone's behalf). Anyone may look up their
 * own links. Replies are always ephemeral.
 */
export class LinkedAccountsCommand implements Command {
  public names = [Lang.getRef('chatCommands.linkedAccounts', Language.Default)]
  public cooldown = new RateLimiter(3, 10000)
  public deferType = CommandDeferType.HIDDEN
  public requireClientPerms: PermissionsString[] = []

  constructor(private readonly userService?: UserService) {}

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    const userService = this.userService
    if (!userService) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.linkAccountNotConfigured', data.lang),
        true,
      )
      return
    }

    const targetUser =
      intr.options.getUser(Lang.getRef('arguments.user', Language.Default)) ?? intr.user
    const isSelf = targetUser.id === intr.user.id

    if (!isSelf) {
      const member = intr.member
      const hasRole =
        member instanceof GuildMember &&
        RoleUtils.memberHasAnyConfiguredRole(member, CoordinatorRoleIds)
      if (!hasRole) {
        Logger.info(`${intr.user.tag} was refused a linked-accounts lookup of ${targetUser.tag}`)
        await InteractionUtils.send(
          intr,
          Lang.getEmbed('displayEmbeds.linkedAccountsNoPermission', data.lang),
          true,
        )
        return
      }
    }

    let accounts: LinkedAccount[]
    try {
      accounts = await userService.listLinkedAccounts(targetUser.id)
    } catch (err: unknown) {
      Logger.error(`/linked-accounts: failed to list linked accounts for ${targetUser.tag}`, err)
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.linkedAccountsFailed', data.lang),
        true,
      )
      return
    }

    // Audit trail of who looked up whom. The identifiers themselves stay out of the log.
    Logger.info(
      `${intr.user.tag} looked up ${targetUser.tag}'s linked accounts (${accounts.length} found)`,
    )

    const subject = isSelf ? 'You' : targetUser.toString()
    if (accounts.length === 0) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.linkedAccountsNone', data.lang, {
          SUBJECT: subject,
          VERB: isSelf ? "haven't" : "hasn't",
        }),
        true,
      )
      return
    }

    await InteractionUtils.send(
      intr,
      Lang.getEmbed('displayEmbeds.linkedAccountsList', data.lang, {
        USER: targetUser.toString(),
        ACCOUNTS: formatLinkedAccounts(accounts, data),
      }),
      true,
    )
  }
}
