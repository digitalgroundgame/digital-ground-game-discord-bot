import { type ChatInputCommandInteraction } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'
import { type EventData } from '../../models/internal-models.js'
import { type Command, CommandDeferType } from '../index.js'
import { Lang } from '../../services/lang.js'
import { type RuleService } from '../../services/rule-service.js'
import { Language } from '../../models/enum-helpers/index.js'
import { InteractionUtils } from '../../utils/interaction-utils.js'

export class RulesCommand implements Command {
  names = [Lang.getRef('chatCommands.rules', Language.Default)]
  cooldown = new RateLimiter(2, 30 * 1000)
  deferType = CommandDeferType.HIDDEN
  requireClientPerms = []

  constructor(private readonly ruleService: RuleService) {}

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    const ruleNumber = intr.options.getInteger(
      Lang.getRef('arguments.ruleNumber', Language.Default),
    )

    // Resolved at display time so /rules-admin changes apply immediately;
    // the rule count is dynamic, so the number is validated here rather
    // than by Discord.
    const rules = await this.ruleService.getRules()

    if (ruleNumber !== null) {
      const rule = rules.find((record) => record.position === ruleNumber)
      if (!rule) {
        await InteractionUtils.send(
          intr,
          Lang.getEmbed('displayEmbeds.ruleNotFound', data.lang, {
            NUMBER: ruleNumber.toString(),
            COUNT: rules.length.toString(),
          }),
        )
        return
      }
      const embed = Lang.getEmbed('displayEmbeds.rules', data.lang)
      embed.addFields([
        {
          name: `**${rule.position}. ${rule.title}**`,
          value: rule.description,
        },
      ])
      await InteractionUtils.send(intr, embed)
      return
    }

    if (rules.length === 0) {
      await InteractionUtils.send(intr, Lang.getEmbed('displayEmbeds.rulesEmpty', data.lang))
      return
    }

    const embed = Lang.getEmbed('displayEmbeds.rules', data.lang)
    embed.addFields(
      rules.map((rule) => ({
        name: `**${rule.position}. ${rule.title}**`,
        value: rule.description,
      })),
    )
    await InteractionUtils.send(intr, embed)
  }
}
