import { type ChatInputCommandInteraction } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'
import { type EventData } from '../../models/internal-models.js'
import { type Command, CommandDeferType } from '../index.js'
import { Lang } from '../../services/lang.js'
import { ContentService } from '../../services/content-service.js'
import { Language } from '../../models/enum-helpers/index.js'
import { InteractionUtils } from '../../utils/interaction-utils.js'
import { ruleContentKey } from '../../constants/managed-content.js'
import { Rules } from '../../constants/rules.js'

export class RulesCommand implements Command {
  names = [Lang.getRef('chatCommands.rules', Language.Default)]
  cooldown = new RateLimiter(2, 30 * 1000)
  deferType = CommandDeferType.HIDDEN
  requireClientPerms = []

  constructor(private readonly contentService?: ContentService) {}

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    const args = {
      ruleNumber: intr.options.getInteger(
        Lang.getRef('arguments.ruleNumber', Language.Default),
      ) as number,
    }

    const embed = Lang.getEmbed('displayEmbeds.rules', data.lang)
    if (args.ruleNumber !== null) {
      // The rule number range is enforced by Discord.
      const rule = await this.getRule(args.ruleNumber)
      embed.addFields([
        {
          name: `**${args.ruleNumber}. ${rule.title}**`,
          value: rule.description,
        },
      ])
    } else {
      const rules = await Promise.all(
        Rules.ServerRules.map((_, index) => this.getRule(index + 1)),
      )
      embed.addFields(
        rules.map((rule, index) => ({
          name: `**${index + 1}. ${rule.title}**`,
          value: rule.description,
        })),
      )
    }

    await InteractionUtils.send(intr, embed)
  }

  /** The nth rule (1-based), resolved at display time so /content edits apply. */
  private async getRule(ruleNumber: number): Promise<{ title: string; description: string }> {
    const rule = Rules.ServerRules[ruleNumber - 1]
    if (!rule) {
      return { title: '', description: '' }
    }
    const key = ruleContentKey(rule.slug)
    const values = this.contentService
      ? await this.contentService.getContent(key)
      : ContentService.getDefaults(key)
    return { title: values['title'] ?? '', description: values['description'] ?? '' }
  }
}
