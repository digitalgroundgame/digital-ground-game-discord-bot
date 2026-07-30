import { type StringSelectMenuInteraction } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'
import { createRequire } from 'node:module'

import { type EventHandler } from './index.js'
import { type SelectMenu, SelectMenuDeferType } from '../select-menus/index.js'
import { type EventDataService } from '../services/index.js'
import { InteractionUtils } from '../utils/index.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

export class SelectMenuHandler implements EventHandler {
  private rateLimiter = new RateLimiter(
    Config.rateLimiting.buttons.amount,
    Config.rateLimiting.buttons.interval * 1000,
  )

  constructor(
    private readonly menus: SelectMenu[],
    private readonly eventDataService: EventDataService,
  ) {}

  public async process(intr: StringSelectMenuInteraction): Promise<void> {
    if (intr.user.bot || this.rateLimiter.take(intr.user.id)) return
    const menu = this.menus.find((candidate) =>
      candidate.ids.some((id) => intr.customId === id || intr.customId.startsWith(`${id}:`)),
    )
    if (!menu || (menu.requireGuild && !intr.guild)) return
    if (menu.deferType === SelectMenuDeferType.REPLY) await InteractionUtils.deferReply(intr, true)
    const data = await this.eventDataService.create({
      user: intr.user,
      channel: intr.channel ?? undefined,
      guild: intr.guild ?? undefined,
    })
    await menu.execute(intr, data)
  }
}
