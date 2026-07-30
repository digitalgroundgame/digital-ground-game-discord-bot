import { type ChatInputCommandInteraction, type PermissionsString } from 'discord.js'

import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import {
  Lang,
  ProjectTrackerPermissions,
  type ProjectTrackerService,
} from '../../services/index.js'
import { buildProjectTrackerPanel } from '../../services/project-tracker-panel.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

export class ProjectTrackerPanelCommand implements Command {
  public names = [Lang.getRef('chatCommands.trackerPanel', Language.Default)]
  public deferType = CommandDeferType.NONE
  public requireClientPerms: PermissionsString[] = []

  constructor(
    private readonly service: ProjectTrackerService,
    private readonly permissions = new ProjectTrackerPermissions(),
  ) {}

  public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
    if (!intr.guildId) {
      await InteractionUtils.send(intr, 'This command can only be used in a server.', true)
      return
    }
    if (intr.guild && !(await this.permissions.can(intr.guild, intr.user.id, 'view'))) {
      await InteractionUtils.send(intr, this.permissions.deniedMessage('view'), true)
      return
    }
    const hidden = intr.options.getString('visibility') === 'hidden'
    await InteractionUtils.send(
      intr,
      await buildProjectTrackerPanel(this.service, intr.guildId),
      hidden,
    )
  }
}
