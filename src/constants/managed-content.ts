import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/**
 * One editable text field of a managed content entry. Rendered as a text
 * input in the `/content edit` modal; `id` is also the storage field name.
 */
export interface ManagedContentField {
  id: string
  label: string
  style: 'short' | 'paragraph'
  maxLength: number
  default: string
}

/** A piece of bot content that may be edited at runtime via `/content`. */
export interface ManagedContentEntry {
  label: string
  description: string
  /** Max 5 fields (Discord modal limit); labels max 45 chars. */
  fields: ManagedContentField[]
}

export const ContentKeys = {
  WelcomeThread: 'welcome-thread',
} as const

const WELCOME_THREAD_MESSAGE = `
### 🗽 Welcome to Digital Ground Game (DGG)
We are a grassroots Liberal political activism community committed to protecting individual liberties, the rule of law, and equal justice.

### 🎯 What We Do
Through our weekly [Call To Action (CTA)](https://digitalgroundgame.org/call-to-action), phonebanking, canvassing, and team-led projects, we organize real political action for real change. Partnering with like-minded organizations, we advance liberal values through a pragmatic, evidence-based approach to improve the material conditions of all Americans.

### 🫡 Get Involved
Activism work isn’t always easy, but we can make it easier by working together to build a brighter future.

A Server Representative will be with you shortly.
In the meantime, feel free to check out the FAQ, join the conversation, or hop into debate or movie night.`

/**
 * Registry of all runtime-editable content. The single source of truth for
 * what `/content` can show/edit/reset; hardcoded defaults live here and are
 * used whenever no database override exists.
 */
export const ManagedContent: Record<string, ManagedContentEntry> = {
  [ContentKeys.WelcomeThread]: {
    label: 'Welcome Thread Message',
    description: 'Posted in the private welcome thread when a new member joins.',
    fields: [
      {
        id: 'message',
        label: 'Message',
        style: 'paragraph',
        maxLength: 4000,
        default: WELCOME_THREAD_MESSAGE,
      },
    ],
  },
}

interface ManagedContentConfig {
  allowedRoleKeys: string[]
}

const rawConfig = (Config.managedContent ?? {}) as Partial<ManagedContentConfig>

/** Role config keys (see `config.roles`) allowed to run `/content`. */
export const ManagedContentAllowedRoleKeys: string[] = Array.isArray(rawConfig.allowedRoleKeys)
  ? rawConfig.allowedRoleKeys
  : []
