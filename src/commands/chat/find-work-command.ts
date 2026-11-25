import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  type EmbedBuilder,
  GuildMember,
  type Locale,
  type PermissionsString,
} from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import {
  type DrawnIssue,
  drawIssues,
  FindWorkPoints,
  type FindWorkPointsConfig,
  type ReviewSuggestion,
  skillSlugsForRoleNames,
  partitionBySkills,
  suggestReviews,
} from '../../constants/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import {
  type GitHubIssuesService,
  type GitHubPullRequestsService,
  Lang,
  Logger,
  type UserService,
  type WorkClaimService,
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

/** "2 Democracy Points", pluralized the way `/democracy-points` does it. */
function pointsText(points: number, lang: Locale): string {
  const category = new Intl.PluralRules(lang).select(points)
  return `${points} ${Lang.getRef(category === 'one' ? 'kudosUnits.one' : 'kudosUnits.other', lang)}`
}

/** The line promising a payout, or nothing when that payout is turned off. */
function rewardLine(ref: string, points: number, lang: Locale): string {
  return points > 0 ? Lang.getRef(ref, lang, { POINTS: pointsText(points, lang) }) : ''
}

/** How many of a suggestion's matched files to name before summarizing the rest. */
const FILES_SHOWN = 3

/** Render one suggested pull request as a line in the reply. */
function describeReview(suggestion: ReviewSuggestion, index: number): string {
  const { pr, matchedFiles } = suggestion
  const shown = matchedFiles.slice(0, FILES_SHOWN).map((path) => `\`${path}\``)
  const more = matchedFiles.length - shown.length
  return [
    `**R${index + 1}.** [${pr.repo} #${pr.number}](${pr.htmlUrl}) — ${pr.title}`,
    `> by ${pr.author} · you’ve worked on ${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`,
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
 * Alongside the draw, it suggests up to two open pull requests that change
 * files the member has committed to before (see `GitHubPullRequestsService`
 * and `suggestReviews`). These sit in their own section rather than taking an
 * issue slot, and pressing one requests a review from the member on GitHub.
 *
 * The reply is ephemeral, so the claim buttons live only as long as the
 * interaction. That is a deliberate trade for now — a draw is personal, and a
 * public one would leak nothing but would clutter the channel.
 */
export class FindWorkCommand implements Command {
  public names = [Lang.getRef('chatCommands.findWork', Language.Default)]
  public cooldown = new RateLimiter(2, 60 * 60 * 1000)
  public deferType = CommandDeferType.HIDDEN
  public requireClientPerms: PermissionsString[] = []

  constructor(
    private readonly issuesService?: GitHubIssuesService,
    private readonly userService?: UserService,
    private readonly claimService?: WorkClaimService,
    private readonly pullRequestsService?: GitHubPullRequestsService,
    /** The amounts promised in replies; the payout job pays the same config. */
    private readonly points: Readonly<FindWorkPointsConfig> = FindWorkPoints,
  ) {}

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    const issuesService = this.issuesService
    const userService = this.userService
    const claimService = this.claimService
    // The command is guild-only, so this only guards the type: points are
    // paid per guild, and a claim needs one to be paid in.
    const guildId = intr.guildId
    if (!issuesService?.isConfigured() || !userService || !claimService || !guildId) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.findWorkNotConfigured', data.lang),
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
        Lang.getEmbed('displayEmbeds.findWorkNotLinked', data.lang),
        true,
      )
      return
    }
    const githubLogin = linked.externalId

    const pool = issuesService.getIssues()
    const pullRequestsService = this.pullRequestsService
    const reviews = pullRequestsService?.isConfigured()
      ? suggestReviews(
          pullRequestsService.getPullRequests(),
          pullRequestsService.getFileAuthors(),
          githubLogin,
        )
      : []
    if (pool.length === 0 && reviews.length === 0) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.findWorkNoneAvailable', data.lang),
        true,
      )
      return
    }

    const roleNames =
      intr.member instanceof GuildMember
        ? intr.member.roles.cache.map((role) => role.name)
        : ([] as string[])
    const skillSlugs = skillSlugsForRoleNames(roleNames)
    const drawn = pool.length > 0 ? drawIssues(pool, skillSlugs) : []

    // Say so rather than quietly serving three wildcards: a silent fallback is
    // how a broken role-to-label mapping goes unnoticed.
    const { matched } = partitionBySkills(pool, skillSlugs)
    const unmatchedNotice = matched.length === 0

    const claimPrefix = `find-work-claim-${intr.id}-`
    const reviewPrefix = `find-work-review-${intr.id}-`
    const embeds: EmbedBuilder[] = []
    const components: ActionRowBuilder<ButtonBuilder>[] = []
    if (drawn.length > 0) {
      embeds.push(
        Lang.getEmbed('displayEmbeds.findWorkDraw', data.lang, {
          ISSUES: drawn.map(describeIssue).join('\n\n'),
          NOTICE: unmatchedNotice
            ? Lang.getRef('findWork.noSkillMatch', data.lang)
            : Lang.getRef('findWork.claimHint', data.lang),
        }),
      )
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          ...drawn.map((entry, index) =>
            new ButtonBuilder()
              .setCustomId(`${claimPrefix}${index}`)
              .setLabel(`Claim #${entry.issue.number}`)
              .setStyle(entry.wildcard ? ButtonStyle.Success : ButtonStyle.Primary),
          ),
        ),
      )
    }
    if (reviews.length > 0) {
      embeds.push(
        Lang.getEmbed('displayEmbeds.findWorkReviews', data.lang, {
          PULLS: reviews.map(describeReview).join('\n\n'),
          HINT: Lang.getRef('findWork.reviewHint', data.lang),
        }),
      )
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          ...reviews.map((suggestion, index) =>
            new ButtonBuilder()
              .setCustomId(`${reviewPrefix}${index}`)
              .setLabel(`Review #${suggestion.pr.number}`)
              .setStyle(ButtonStyle.Secondary),
          ),
        ),
      )
    }

    const message = await InteractionUtils.send(intr, { embeds, components }, true)
    if (!message) return

    let button
    try {
      button = await message.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) =>
          i.user.id === intr.user.id &&
          (i.customId.startsWith(claimPrefix) || i.customId.startsWith(reviewPrefix)),
        time: CLAIM_TIMEOUT_MS,
      })
    } catch {
      await InteractionUtils.editReply(intr, {
        embeds: [Lang.getEmbed('displayEmbeds.findWorkTimedOut', data.lang)],
        components: [],
      })
      return
    }

    // Acknowledge the press before any GitHub call. Claiming and requesting a
    // review each make up to three requests with a 10-second timeout apiece,
    // well past Discord's 3-second window for answering a button.
    await InteractionUtils.deferUpdate(button)

    const index = Number.parseInt(button.customId.split('-').pop() ?? '', 10)
    if (button.customId.startsWith(reviewPrefix)) {
      await this.requestReview(button, reviews[index], githubLogin, guildId, claimService, data)
      return
    }
    const choice = drawn[index]
    if (!choice) {
      await InteractionUtils.editReply(button, {
        embeds: [Lang.getEmbed('displayEmbeds.findWorkFailed', data.lang)],
        components: [],
      })
      return
    }
    const { issue } = choice

    // Record the claim before assigning, so the one-live-claim index settles a
    // race between two members pressing Claim on the same issue: only one
    // insert lands, and the other member is never assigned.
    let claimId: number | undefined
    try {
      claimId = await claimService.recordClaim({
        guildId,
        discordUserId: intr.user.id,
        githubLogin,
        repo: issue.repo,
        issueNumber: issue.number,
        wildcard: choice.wildcard,
      })
    } catch (err: unknown) {
      Logger.error(`/find-work: failed to record a claim on ${issue.repo}#${issue.number}`, err)
      await InteractionUtils.editReply(button, {
        embeds: [Lang.getEmbed('displayEmbeds.findWorkFailed', data.lang)],
        components: [],
      })
      return
    }
    if (claimId === undefined) {
      await InteractionUtils.editReply(button, {
        embeds: [
          Lang.getEmbed('displayEmbeds.findWorkAlreadyClaimed', data.lang, {
            REPO: issue.repo,
            NUMBER: issue.number.toString(),
          }),
        ],
        components: [],
      })
      return
    }
    const release = async (): Promise<void> => {
      try {
        await claimService.releaseClaim(claimId)
      } catch (err: unknown) {
        Logger.error(
          `/find-work: failed to release the unassigned claim on ${issue.repo}#${issue.number}`,
          err,
        )
      }
    }

    // The pool is refreshed hourly, so the issue may have been assigned or
    // closed on GitHub since it was drawn. Check before assigning, or the
    // member would land as a second assignee beside whoever took it.
    const live = await issuesService.getIssueState(issue.repo, issue.number)
    if (!live || live.state !== 'open' || live.assignees.length > 0) {
      await release()
      await InteractionUtils.editReply(button, {
        embeds: [
          live
            ? Lang.getEmbed('displayEmbeds.findWorkAlreadyClaimed', data.lang, {
                REPO: issue.repo,
                NUMBER: issue.number.toString(),
              })
            : Lang.getEmbed('displayEmbeds.findWorkFailed', data.lang),
        ],
        components: [],
      })
      return
    }

    const assignable = await issuesService.isAssignable(issue.repo, githubLogin)
    if (assignable !== 'assignable') {
      // On a public repo `not-assignable` mostly means an unaccepted org
      // invitation. A lead has to grant access before the assignment can
      // land; whether the bot should raise that request itself is still open.
      // `error` is GitHub not answering, which says nothing about access.
      await release()
      await InteractionUtils.editReply(button, {
        embeds: [
          assignable === 'not-assignable'
            ? Lang.getEmbed('displayEmbeds.findWorkNeedsAccess', data.lang, {
                LOGIN: githubLogin,
                REPO: issue.repo,
              })
            : Lang.getEmbed('displayEmbeds.findWorkFailed', data.lang),
        ],
        components: [],
      })
      return
    }

    const result = await issuesService.assign(issue.repo, issue.number, githubLogin)
    let assigned = result.status === 'assigned'
    if (result.status === 'error') {
      // A timeout or a lost response doesn't mean GitHub didn't apply the
      // assignment. Look before releasing, or a member who is assigned would
      // be left without a claim to be paid on.
      const after = await issuesService.getIssueState(issue.repo, issue.number)
      if (!after) {
        // Can't tell either way, so keep the claim: if the assignment never
        // landed, the payout job expires it once the grace period is over.
        Logger.warn(
          `/find-work: couldn't confirm whether ${githubLogin} was assigned to ${issue.repo}#${issue.number}; keeping the claim`,
        )
        await InteractionUtils.editReply(button, {
          embeds: [
            Lang.getEmbed('displayEmbeds.findWorkClaimUnconfirmed', data.lang, {
              LOGIN: githubLogin,
              REPO: issue.repo,
              NUMBER: issue.number.toString(),
              URL: issue.htmlUrl,
            }),
          ],
          components: [],
        })
        return
      }
      assigned = after.assignees.includes(githubLogin.toLowerCase())
    }
    if (!assigned) {
      await release()
      await InteractionUtils.editReply(button, {
        embeds: [Lang.getEmbed('displayEmbeds.findWorkFailed', data.lang)],
        components: [],
      })
      return
    }

    Logger.info(
      `${intr.user.tag} claimed ${issue.repo}#${issue.number} as ${githubLogin}${choice.wildcard ? ' [wildcard]' : ''}`,
    )
    await InteractionUtils.editReply(button, {
      embeds: [
        Lang.getEmbed('displayEmbeds.findWorkClaimed', data.lang, {
          REPO: issue.repo,
          NUMBER: issue.number.toString(),
          TITLE: issue.title,
          URL: issue.htmlUrl,
          LOGIN: githubLogin,
          REWARD: rewardLine(
            'findWork.issueReward',
            choice.wildcard ? this.points.wildcardIssue : this.points.issue,
            data.lang,
          ),
        }),
      ],
      components: [],
    })
  }

  private async requestReview(
    button: ButtonInteraction,
    suggestion: ReviewSuggestion | undefined,
    githubLogin: string,
    guildId: string,
    claimService: WorkClaimService,
    data: EventData,
  ): Promise<void> {
    const pullRequestsService = this.pullRequestsService
    if (!suggestion || !pullRequestsService) {
      await InteractionUtils.editReply(button, {
        embeds: [Lang.getEmbed('displayEmbeds.findWorkReviewFailed', data.lang)],
        components: [],
      })
      return
    }
    const { pr } = suggestion

    const result = await pullRequestsService.requestReview(pr.repo, pr.number, githubLogin)
    if (result.status === 'not-assignable') {
      await InteractionUtils.editReply(button, {
        embeds: [
          Lang.getEmbed('displayEmbeds.findWorkReviewNeedsAccess', data.lang, {
            LOGIN: githubLogin,
            REPO: pr.repo,
          }),
        ],
        components: [],
      })
      return
    }
    if (result.status !== 'assigned') {
      await InteractionUtils.editReply(button, {
        embeds: [Lang.getEmbed('displayEmbeds.findWorkReviewFailed', data.lang)],
        components: [],
      })
      return
    }

    try {
      await claimService.recordReviewRequest({
        guildId,
        discordUserId: button.user.id,
        githubLogin,
        repo: pr.repo,
        pullNumber: pr.number,
      })
    } catch (err: unknown) {
      // Same as an unrecorded claim: the request landed, the payout won't.
      Logger.error(
        `/find-work: requested review of ${pr.repo}#${pr.number} from ${githubLogin} but failed to record it`,
        err,
      )
      await InteractionUtils.editReply(button, {
        embeds: [
          Lang.getEmbed('displayEmbeds.findWorkReviewNotRecorded', data.lang, {
            REPO: pr.repo,
            NUMBER: pr.number.toString(),
            URL: pr.htmlUrl,
          }),
        ],
        components: [],
      })
      return
    }

    Logger.info(`${button.user.tag} requested review of ${pr.repo}#${pr.number} as ${githubLogin}`)
    await InteractionUtils.editReply(button, {
      embeds: [
        Lang.getEmbed('displayEmbeds.findWorkReviewRequested', data.lang, {
          LOGIN: githubLogin,
          REPO: pr.repo,
          NUMBER: pr.number.toString(),
          TITLE: pr.title,
          URL: pr.htmlUrl,
          REWARD: rewardLine('findWork.reviewReward', this.points.review, data.lang),
        }),
      ],
      components: [],
    })
  }
}
