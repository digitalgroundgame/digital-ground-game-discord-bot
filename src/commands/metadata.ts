import {
  ApplicationCommandType,
  PermissionFlagsBits,
  PermissionsBitField,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type RESTPostAPIContextMenuApplicationCommandsJSONBody,
} from 'discord.js'

import { Args } from './index.js'
import { Language } from '../models/enum-helpers/index.js'
import { Lang } from '../services/index.js'
import { ONBOARDING_CONFIGS } from '../commands/user/index.js'

export const ChatCommandMetadata: {
  [command: string]: RESTPostAPIChatInputApplicationCommandsJSONBody
} = {
  DEV: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.dev', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('chatCommands.dev'),
    description: Lang.getRef('commandDescs.dev', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('commandDescs.dev'),
    dm_permission: true,
    default_member_permissions: PermissionsBitField.resolve([
      PermissionFlagsBits.Administrator,
    ]).toString(),
    options: [
      {
        ...Args.DEV_COMMAND,
        required: true,
      },
    ],
  },
  HELP: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.help', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('chatCommands.help'),
    description: Lang.getRef('commandDescs.help', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('commandDescs.help'),
    dm_permission: true,
    default_member_permissions: undefined,
    options: [
      {
        ...Args.HELP_OPTION,
        required: true,
      },
    ],
  },
  INFO: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.info', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('chatCommands.info'),
    description: Lang.getRef('commandDescs.info', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('commandDescs.info'),
    dm_permission: true,
    default_member_permissions: undefined,
    options: [
      {
        ...Args.INFO_OPTION,
        required: true,
      },
    ],
  },
  TEST: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.test', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('chatCommands.test'),
    description: Lang.getRef('commandDescs.test', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('commandDescs.test'),
    dm_permission: true,
    default_member_permissions: undefined,
  },
  RULES: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.rules', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('chatCommands.rules'),
    description: Lang.getRef('commandDescs.rules', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('commandDescs.rules'),
    default_member_permissions: undefined,
    options: [
      {
        ...Args.RULES_OPTIION,
        required: false,
      },
    ],
  },
  PRAGPAPER: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.pragPapers', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('chatCommands.pragPapers'),
    description: Lang.getRef('commandDescs.pragPapers', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('commandDescs.pragPapers'),
    default_member_permissions: undefined,
  },
  CENSUS: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.census', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('chatCommands.census'),
    description: Lang.getRef('commandDescs.census', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('commandDescs.census'),
    default_member_permissions: undefined,
  },
  ATTENDANCE: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.attendance', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('chatCommands.attendance'),
    description: Lang.getRef('commandDescs.attendance', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('commandDescs.attendance'),
    default_member_permissions: undefined,
  },
  ATTENDANCE_TRACK: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.attendanceTrack', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('chatCommands.attendanceTrack'),
    description: Lang.getRef('commandDescs.attendanceTrack', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('commandDescs.attendanceTrack'),
    default_member_permissions: undefined,
    options: [Args.ATTENDANCE_TRACK_NAME],
  },
}

export const MessageCommandMetadata: {
  [command: string]: RESTPostAPIContextMenuApplicationCommandsJSONBody
} = {}

export const UserCommandMetadata: {
  [command: string]: RESTPostAPIContextMenuApplicationCommandsJSONBody
} = Object.fromEntries(
  ONBOARDING_CONFIGS.map((config) => [
    config.metadataKey,
    {
      type: ApplicationCommandType.User,
      name: Lang.getRef(config.langKey, Language.Default),
      name_localizations: Lang.getRefLocalizationMap(config.langKey),
      default_member_permissions: undefined,
      dm_permission: true,
    },
  ]),
)
