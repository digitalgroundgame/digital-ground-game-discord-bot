import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  GuildMember,
  type PermissionsString,
} from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import {
  type DrawnIssue,
  drawIssues,
  skillSlugsForRoleNames,
  partitionBySkills,
} from '../../constants/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import {
  type GitHubIssuesService,
  type IssueClaimService,
  Lang,
  Logger,
  type UserService,
} from '../../services/index.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

/** How long the claim buttons stay live before the draw goes stale. */
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000

/** Render one drawn issue as a line in the reply. */
function describeIssue(drawn: DrawnIssue, index: number): string {
  const { issue } = drawn
  const tag = drawn.wildcard ? ' ⭐ **wildcard**' : ''
  return [
    `**${index + 1}.** [${issue.repo} #${issue.number}](${issue.htmlUrl}) — ${issue.title}${tag}`,
    `> ${issue.labels.join(' · ')}`,
  ].join('\n')
}

/**
 * Offers a member three open issues they could pick up and assigns them to
 * whichever one they claim.
 *
 * Two of the three are matched against the skill roles the member holds in
 * Discord; the third is a wildcard drawn from work their roles don't cover,
 * weighted toward whatever has been sitting longest. Everything on offer comes
 * from the cached pool (see `GitHubIssuesService`), which holds only open,
 * unassigned, marker-labelled issues in the org's *public* repositories.
 *
 * The reply is ephemeral, so the claim buttons live only as long as the
 * interaction. That is a deliberate trade for now — a draw is personal, and a
 * public one would leak nothing but would clutter the channel.
 */
export class GiveIssueCommand implements Command {
  public names = [Lang.getRef('chatCommands.giveIssue', Language.Default)]
  public cooldown = new RateLimiter(2, 60 * 60 * 1000)
  public deferType = CommandDeferType.HIDDEN
  public requireClientPerms: PermissionsString[] = []

  constructor(
    private readonly issuesService?: GitHubIssuesService,
    private readonly userService?: UserService,
    private readonly claimService?: IssueClaimService,
  ) {}

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    const issuesService = this.issuesService
    const userService = this.userService
    const claimService = this.claimService
    if (!issuesService?.isConfigured() || !userService || !claimService) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.giveIssueNotConfigured', data.lang),
        true,
      )
      return
    }

    // Claiming assigns a GitHub account, so there has to be one to assign.
    // Checked before the draw so a member who cannot act on the result is not
    // shown one.
    const linked = await userService.findLinkedAccount(intr.user.id, 'github')
    if (!linked) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.giveIssueNotLinked', data.lang),
        true,
      )
      return
    }
    const githubLogin = linked.externalId

    const pool = issuesService.getIssues()
    if (pool.length === 0) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.giveIssueNoneAvailable', data.lang),
        true,
      )
      return
    }

    const roleNames =
      intr.member instanceof GuildMember
        ? intr.member.roles.cache.map((role) => role.name)
        : ([] as string[])
    const skillSlugs = skillSlugsForRoleNames(roleNames)
    const drawn = drawIssues(pool, skillSlugs)

    // Say so rather than quietly serving three wildcards: a silent fallback is
    // how a broken role-to-label mapping goes unnoticed.
    const { matched } = partitionBySkills(pool, skillSlugs)
    const unmatchedNotice = matched.length === 0

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...drawn.map((entry, index) =>
        new ButtonBuilder()
          .setCustomId(`give-issue-claim-${intr.id}-${index}`)
          .setLabel(`Claim #${entry.issue.number}`)
          .setStyle(entry.wildcard ? ButtonStyle.Success : ButtonStyle.Primary),
      ),
    )

    const message = await InteractionUtils.send(
      intr,
      {
        embeds: [
          Lang.getEmbed('displayEmbeds.giveIssueDraw', data.lang, {
            ISSUES: drawn.map(describeIssue).join('\n\n'),
            NOTICE: unmatchedNotice
              ? Lang.getRef('giveIssue.noSkillMatch', data.lang)
              : Lang.getRef('giveIssue.claimHint', data.lang),
          }),
        ],
        components: [buttons],
      },
      true,
    )
    if (!message) return

    let button
    try {
      button = await message.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) =>
          i.user.id === intr.user.id && i.customId.startsWith(`give-issue-claim-${intr.id}-`),
        time: CLAIM_TIMEOUT_MS,
      })
    } catch {
      await InteractionUtils.editReply(intr, {
        embeds: [Lang.getEmbed('displayEmbeds.giveIssueTimedOut', data.lang)],
        components: [],
      })
      return
    }

    const index = Number.parseInt(button.customId.split('-').pop() ?? '', 10)
    const choice = drawn[index]
    if (!choice) {
      await InteractionUtils.update(button, {
        embeds: [Lang.getEmbed('displayEmbeds.giveIssueFailed', data.lang)],
        components: [],
      })
      return
    }
    const { issue } = choice

    // Someone else may have taken it between the draw and the press.
    const existing = await claimService.findLiveClaim(issue.repo, issue.number)
    if (existing) {
      await InteractionUtils.update(button, {
        embeds: [
          Lang.getEmbed('displayEmbeds.giveIssueAlreadyClaimed', data.lang, {
            REPO: issue.repo,
            NUMBER: issue.number.toString(),
          }),
        ],
        components: [],
      })
      return
    }

    if (!(await issuesService.isAssignable(issue.repo, githubLogin))) {
      // On a public repo this mostly means an unaccepted org invitation. A
      // lead has to grant access before the assignment can land; whether the
      // bot should raise that request itself is still open.
      await InteractionUtils.update(button, {
        embeds: [
          Lang.getEmbed('displayEmbeds.giveIssueNeedsAccess', data.lang, {
            LOGIN: githubLogin,
            REPO: issue.repo,
          }),
        ],
        components: [],
      })
      return
    }

    const result = await issuesService.assign(issue.repo, issue.number, githubLogin)
    if (result.status !== 'assigned') {
      await InteractionUtils.update(button, {
        embeds: [Lang.getEmbed('displayEmbeds.giveIssueFailed', data.lang)],
        components: [],
      })
      return
    }

    try {
      await claimService.recordClaim({
        discordUserId: intr.user.id,
        githubLogin,
        repo: issue.repo,
        issueNumber: issue.number,
        wildcard: choice.wildcard,
      })
    } catch (err: unknown) {
      // The assignment landed but the record didn't, so a later payout would
      // have nothing to attribute. Say so rather than implying a clean claim.
      Logger.error(
        `/give-issue: assigned ${githubLogin} to ${issue.repo}#${issue.number} but failed to record the claim`,
        err,
      )
      await InteractionUtils.update(button, {
        embeds: [
          Lang.getEmbed('displayEmbeds.giveIssueClaimNotRecorded', data.lang, {
            REPO: issue.repo,
            NUMBER: issue.number.toString(),
            URL: issue.htmlUrl,
          }),
        ],
        components: [],
      })
      return
    }

    Logger.info(
      `${intr.user.tag} claimed ${issue.repo}#${issue.number} as ${githubLogin}${choice.wildcard ? ' [wildcard]' : ''}`,
    )
    await InteractionUtils.update(button, {
      embeds: [
        Lang.getEmbed('displayEmbeds.giveIssueClaimed', data.lang, {
          REPO: issue.repo,
          NUMBER: issue.number.toString(),
          TITLE: issue.title,
          URL: issue.htmlUrl,
          LOGIN: githubLogin,
        }),
      ],
      components: [],
    })
  }
}
