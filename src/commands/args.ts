import { type APIApplicationCommandBasicOption, ApplicationCommandOptionType } from 'discord.js'

import { DevCommandName, HelpOption, InfoOption } from '../enums/index.js'
import { Language } from '../models/enum-helpers/index.js'
import { Lang } from '../services/index.js'
import { Rules } from '../constants/rules.js'
import { GoogleGroups, LinkableAccounts } from '../constants/index.js'

export class Args {
  public static readonly DEV_COMMAND: APIApplicationCommandBasicOption = {
    name: Lang.getRef('arguments.command', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('arguments.command'),
    description: Lang.getRef('argDescs.devCommand', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('argDescs.devCommand'),
    type: ApplicationCommandOptionType.String,
    choices: [
      {
        name: Lang.getRef('devCommandNames.info', Language.Default),
        name_localizations: Lang.getRefLocalizationMap('devCommandNames.info'),
        value: DevCommandName.INFO,
      },
    ],
  }
  public static readonly HELP_OPTION: APIApplicationCommandBasicOption = {
    name: Lang.getRef('arguments.option', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('arguments.option'),
    description: Lang.getRef('argDescs.helpOption', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('argDescs.helpOption'),
    type: ApplicationCommandOptionType.String,
    choices: [
      {
        name: Lang.getRef('helpOptionDescs.contactSupport', Language.Default),
        name_localizations: Lang.getRefLocalizationMap('helpOptionDescs.contactSupport'),
        value: HelpOption.CONTACT_SUPPORT,
      },
      {
        name: Lang.getRef('helpOptionDescs.commands', Language.Default),
        name_localizations: Lang.getRefLocalizationMap('helpOptionDescs.commands'),
        value: HelpOption.COMMANDS,
      },
    ],
  }
  public static readonly INFO_OPTION: APIApplicationCommandBasicOption = {
    name: Lang.getRef('arguments.option', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('arguments.option'),
    description: Lang.getRef('argDescs.helpOption', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('argDescs.helpOption'),
    type: ApplicationCommandOptionType.String,
    choices: [
      {
        name: Lang.getRef('infoOptions.about', Language.Default),
        name_localizations: Lang.getRefLocalizationMap('infoOptions.about'),
        value: InfoOption.ABOUT,
      },
      {
        name: Lang.getRef('infoOptions.translate', Language.Default),
        name_localizations: Lang.getRefLocalizationMap('infoOptions.translate'),
        value: InfoOption.TRANSLATE,
      },
    ],
  }
  public static readonly GRANT_ACCESS_SERVICE: APIApplicationCommandBasicOption = {
    name: Lang.getRef('arguments.service', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('arguments.service'),
    description: Lang.getRef('argDescs.grantAccessService', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('argDescs.grantAccessService'),
    type: ApplicationCommandOptionType.String,
    choices: LinkableAccounts.map((account) => ({
      name: account.label,
      value: account.provider,
    })),
  }
  public static readonly GRANT_ACCESS_TEAM: APIApplicationCommandBasicOption = {
    name: Lang.getRef('arguments.team', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('arguments.team'),
    description: Lang.getRef('argDescs.grantAccessTeam', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('argDescs.grantAccessTeam'),
    type: ApplicationCommandOptionType.String,
    choices: Object.keys(GoogleGroups).map((shortname) => ({
      name: shortname,
      value: shortname,
    })),
  }
  public static readonly GRANT_ACCESS_USER: APIApplicationCommandBasicOption = {
    name: Lang.getRef('arguments.user', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('arguments.user'),
    description: Lang.getRef('argDescs.grantAccessUser', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('argDescs.grantAccessUser'),
    type: ApplicationCommandOptionType.User,
  }
  public static readonly LINK_ACCOUNT_SERVICE: APIApplicationCommandBasicOption = {
    name: Lang.getRef('arguments.service', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('arguments.service'),
    description: Lang.getRef('argDescs.linkAccountService', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('argDescs.linkAccountService'),
    type: ApplicationCommandOptionType.String,
    choices: LinkableAccounts.map((account) => ({
      name: account.label,
      value: account.provider,
    })),
  }
  public static readonly LINK_ACCOUNT_IDENTIFIER: APIApplicationCommandBasicOption = {
    name: Lang.getRef('arguments.identifier', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('arguments.identifier'),
    description: Lang.getRef('argDescs.linkAccountIdentifier', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('argDescs.linkAccountIdentifier'),
    type: ApplicationCommandOptionType.String,
  }
  public static readonly LINK_ACCOUNT_USER: APIApplicationCommandBasicOption = {
    name: Lang.getRef('arguments.user', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('arguments.user'),
    description: Lang.getRef('argDescs.linkAccountUser', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('argDescs.linkAccountUser'),
    type: ApplicationCommandOptionType.User,
  }
  public static readonly RULES_OPTIION: APIApplicationCommandBasicOption = {
    name: Lang.getRef('arguments.ruleNumber', Language.Default),
    name_localizations: Lang.getRefLocalizationMap('arguments.ruleNumber'),
    description: Lang.getRef('argDescs.ruleNumber', Language.Default),
    description_localizations: Lang.getRefLocalizationMap('argDescs.ruleNumber'),
    type: ApplicationCommandOptionType.Integer,
    required: false,
    min_value: 1,
    max_value: Rules.ServerRules.length,
  }
}
