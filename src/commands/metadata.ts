import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  PermissionFlagsBits,
  PermissionsBitField,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type RESTPostAPIContextMenuApplicationCommandsJSONBody,
} from 'discord.js'

import { Args } from './index.js'
import { ContentSubcommand } from '../enums/index.js'
import { Language } from '../models/enum-helpers/index.js'
import { Lang } from '../services/index.js'
import { ONBOARDING_CONFIGS } from '../commands/user/index.js'

export const ChatCommandMetadata: {
  [command: string]: RESTPostAPIChatInputApplicationCommandsJSONBody
} = {
  CONTENT: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.content', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('chatCommands.content'),
    description: Lang.getRef('commandDescs.content', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('commandDescs.content'),
    dm_permission: false,
    default_member_permissions: undefined,
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: ContentSubcommand.SHOW,
        description: Lang.getRef('commandDescs.contentShow', Language.Default),
        options: [{ ...Args.CONTENT_KEY, required: true }],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: ContentSubcommand.EDIT,
        description: Lang.getRef('commandDescs.contentEdit', Language.Default),
        options: [{ ...Args.CONTENT_KEY, required: true }],
      },
    ],
  },
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
  STOP_ATTENDANCE_TRACK: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.stopAttendanceTrack', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('chatCommands.stopAttendanceTrack'),
    description: Lang.getRef('commandDescs.stopAttendanceTrack', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('commandDescs.stopAttendanceTrack'),
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
  GRANT_ACCESS: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.grantAccess', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('chatCommands.grantAccess'),
    description: Lang.getRef('commandDescs.grantAccess', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('commandDescs.grantAccess'),
    dm_permission: false,
    default_member_permissions: undefined,
    options: [
      {
        ...Args.GRANT_ACCESS_SERVICE,
        required: true,
      },
      {
        ...Args.GRANT_ACCESS_TEAM,
        required: true,
      },
      {
        ...Args.GRANT_ACCESS_USER,
        required: true,
      },
    ],
  },
  LINK_ACCOUNT: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.linkAccount', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('chatCommands.linkAccount'),
    description: Lang.getRef('commandDescs.linkAccount', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('commandDescs.linkAccount'),
    dm_permission: false,
    default_member_permissions: undefined,
    options: [
      {
        ...Args.LINK_ACCOUNT_SERVICE,
        required: true,
      },
      {
        ...Args.LINK_ACCOUNT_IDENTIFIER,
        required: true,
      },
      {
        ...Args.LINK_ACCOUNT_USER,
        required: false,
      },
    ],
  },
  PROJECT: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.project', Language.Default),
    description: Lang.getRef('commandDescs.project', Language.Default),
    dm_permission: false,
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'new',
        description: Lang.getRef('commandDescs.projectNew', Language.Default),
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'name',
            description: Lang.getRef('argDescs.projectName', Language.Default),
            required: true,
            max_length: 100,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'description',
            description: Lang.getRef('argDescs.description', Language.Default),
            required: false,
            max_length: 1000,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'list',
        description: Lang.getRef('commandDescs.projectList', Language.Default),
        options: [
          {
            type: ApplicationCommandOptionType.Boolean,
            name: 'include_archived',
            description: Lang.getRef('argDescs.includeArchived', Language.Default),
            required: false,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'view',
        description: Lang.getRef('commandDescs.projectView', Language.Default),
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'name',
            description: Lang.getRef('argDescs.projectName', Language.Default),
            required: true,
            autocomplete: true,
          },
        ],
      },
    ],
  },
  MILESTONE: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.milestone', Language.Default),
    description: Lang.getRef('commandDescs.milestone', Language.Default),
    dm_permission: false,
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'add',
        description: Lang.getRef('commandDescs.milestoneAdd', Language.Default),
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'project',
            description: Lang.getRef('argDescs.projectName', Language.Default),
            required: true,
            autocomplete: true,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'name',
            description: Lang.getRef('argDescs.milestoneName', Language.Default),
            required: true,
            max_length: 100,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'description',
            description: Lang.getRef('argDescs.description', Language.Default),
            required: false,
            max_length: 1000,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'list',
        description: Lang.getRef('commandDescs.milestoneList', Language.Default),
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'project',
            description: Lang.getRef('argDescs.projectName', Language.Default),
            required: true,
            autocomplete: true,
          },
        ],
      },
    ],
  },
  TASK: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.task', Language.Default),
    description: Lang.getRef('commandDescs.task', Language.Default),
    dm_permission: false,
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'add',
        description: Lang.getRef('commandDescs.taskAdd', Language.Default),
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'project',
            description: Lang.getRef('argDescs.projectName', Language.Default),
            required: true,
            autocomplete: true,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'milestone',
            description: Lang.getRef('argDescs.milestoneName', Language.Default),
            required: true,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'title',
            description: Lang.getRef('argDescs.taskTitle', Language.Default),
            required: true,
            max_length: 200,
          },
          {
            type: ApplicationCommandOptionType.User,
            name: 'assignee',
            description: Lang.getRef('argDescs.assignee', Language.Default),
            required: false,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'list',
        description: Lang.getRef('commandDescs.taskList', Language.Default),
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'project',
            description: Lang.getRef('argDescs.projectName', Language.Default),
            required: true,
            autocomplete: true,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'status',
            description: Lang.getRef('argDescs.taskStatus', Language.Default),
            required: false,
            choices: ['todo', 'doing', 'blocked', 'done'].map((value) => ({ name: value, value })),
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'status',
        description: Lang.getRef('commandDescs.taskStatus', Language.Default),
        options: [
          {
            type: ApplicationCommandOptionType.Integer,
            name: 'task_id',
            description: Lang.getRef('argDescs.taskId', Language.Default),
            required: true,
            min_value: 1,
          },
          {
            type: ApplicationCommandOptionType.String,
            name: 'status',
            description: Lang.getRef('argDescs.taskStatus', Language.Default),
            required: true,
            choices: ['todo', 'doing', 'blocked', 'done'].map((value) => ({ name: value, value })),
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'assign',
        description: Lang.getRef('commandDescs.taskAssign', Language.Default),
        options: [
          {
            type: ApplicationCommandOptionType.Integer,
            name: 'task_id',
            description: Lang.getRef('argDescs.taskId', Language.Default),
            required: true,
            min_value: 1,
          },
          {
            type: ApplicationCommandOptionType.User,
            name: 'assignee',
            description: Lang.getRef('argDescs.assignee', Language.Default),
            required: false,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'done',
        description: Lang.getRef('commandDescs.taskDone', Language.Default),
        options: [
          {
            type: ApplicationCommandOptionType.Integer,
            name: 'task_id',
            description: Lang.getRef('argDescs.taskId', Language.Default),
            required: true,
            min_value: 1,
          },
        ],
      },
    ],
  },
  PROGRESS: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.progress', Language.Default),
    description: Lang.getRef('commandDescs.progress', Language.Default),
    dm_permission: false,
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: 'project',
        description: Lang.getRef('argDescs.projectName', Language.Default),
        required: true,
        autocomplete: true,
      },
    ],
  },
  TRACKER_PANEL: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.trackerPanel', Language.Default),
    description: Lang.getRef('commandDescs.trackerPanel', Language.Default),
    dm_permission: false,
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: 'visibility',
        description: Lang.getRef('argDescs.panelVisibility', Language.Default),
        required: false,
        choices: [
          { name: 'public', value: 'public' },
          { name: 'hidden', value: 'hidden' },
        ],
      },
    ],
  },
  ROLES: {
    type: ApplicationCommandType.ChatInput,
    name: Lang.getRef('chatCommands.roles', Language.Default),
    description: Lang.getRef('commandDescs.roles', Language.Default),
    dm_permission: false,
    default_member_permissions: PermissionsBitField.resolve([
      PermissionFlagsBits.ManageRoles,
    ]).toString(),
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
