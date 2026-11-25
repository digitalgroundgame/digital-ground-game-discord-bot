import { createRequire } from 'node:module'

import { type RoleKey, validateAllowedRoleKeys } from './server-roles.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

export interface ClipSuggestionsSettings {
  /** Destination for suggestions; undefined means delivery is not set up. */
  channelId: string | undefined
  allowedRoleKeys: RoleKey[]
}

/**
 * Reads the `clipSuggestions` config section. A missing or empty channel id
 * is allowed (the destination may not exist yet); unknown role keys are not.
 * Exported for tests.
 */
export function parseClipSuggestionsConfig(raw: unknown): ClipSuggestionsSettings {
  const section = (raw ?? {}) as { channelId?: unknown; allowedRoleKeys?: unknown }

  const rawChannelId = section.channelId
  if (rawChannelId !== undefined && rawChannelId !== null && typeof rawChannelId !== 'string') {
    throw new Error(
      `config.clipSuggestions.channelId must be a string channel id (got: ${String(rawChannelId)}); quote it so the snowflake isn't rounded`,
    )
  }

  return {
    channelId: rawChannelId?.trim() || undefined,
    allowedRoleKeys: validateAllowedRoleKeys(
      section.allowedRoleKeys,
      'config.clipSuggestions.allowedRoleKeys',
      '/clip',
      { allowEmpty: true },
    ),
  }
}

const settings = parseClipSuggestionsConfig(Config.clipSuggestions)

/** Forum, text/announcement channel or thread that `/clip` posts to, if set. */
export const ClipSuggestionsChannelId: string | undefined = settings.channelId

/**
 * Role config keys (see `config.roles`) allowed to run `/clip`. An empty or
 * missing list lets every member submit.
 */
export const ClipSuggestionsAllowedRoleKeys: RoleKey[] = settings.allowedRoleKeys
