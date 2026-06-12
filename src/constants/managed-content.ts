import { createRequire } from 'node:module'

import {
  DevOnboarding,
  EventsOnboarding,
  MediaOnboarding,
  ResearchOnboarding,
  WelcomeOnboarding,
} from './onboarding.js'
import { Rules } from './rules.js'

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
  /** Whether the modal input may be submitted empty (defaults to required). */
  required?: boolean
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
  OnboardingDev: 'onboarding-dev',
  OnboardingEvents: 'onboarding-events',
  OnboardingMedia: 'onboarding-media',
  OnboardingResearch: 'onboarding-research',
  OnboardingWelcome: 'onboarding-welcome',
} as const

/** Managed content key for the nth server rule (1-based). */
export function ruleContentKey(ruleNumber: number): string {
  return `rule-${ruleNumber}`
}

const WELCOME_THREAD_MESSAGE = `
### 🗽 Welcome to Digital Ground Game (DGG)
We are a grassroots Liberal political activism community committed to protecting individual liberties, the rule of law, and equal justice.

### 🎯 What We Do
Through our weekly [Call To Action (CTA)](https://digitalgroundgame.org/call-to-action), phonebanking, canvassing, and team-led projects, we organize real political action for real change. Partnering with like-minded organizations, we advance liberal values through a pragmatic, evidence-based approach to improve the material conditions of all Americans.

### 🫡 Get Involved
Activism work isn’t always easy, but we can make it easier by working together to build a brighter future.

A Server Representative will be with you shortly.
In the meantime, feel free to check out the FAQ, join the conversation, or hop into debate or movie night.`

/** A team onboarding DM: an embed title plus its message body. */
function onboardingEntry(
  team: string,
  defaults: { Title: string; Message: string },
): ManagedContentEntry {
  return {
    label: `${team} Onboarding`,
    description: `DMed by the "Send ${team} Onboarding" context menu command.`,
    fields: [
      { id: 'title', label: 'Title', style: 'short', maxLength: 256, default: defaults.Title },
      {
        id: 'message',
        label: 'Message',
        style: 'paragraph',
        maxLength: 4000,
        default: defaults.Message,
      },
    ],
  }
}

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
  [ContentKeys.OnboardingDev]: onboardingEntry('Dev Team', DevOnboarding),
  [ContentKeys.OnboardingEvents]: onboardingEntry('Events Team', EventsOnboarding),
  [ContentKeys.OnboardingMedia]: onboardingEntry('Media Team', MediaOnboarding),
  [ContentKeys.OnboardingResearch]: onboardingEntry('Research Team', ResearchOnboarding),
  [ContentKeys.OnboardingWelcome]: onboardingEntry('Welcome Team', WelcomeOnboarding),
  // Rule text is editable; the rule *count* stays code-defined (the /rules
  // number option range is registered statically from Rules.ServerRules).
  ...Object.fromEntries(
    Rules.ServerRules.map((rule, index) => [
      ruleContentKey(index + 1),
      {
        label: `Rule ${index + 1}: ${rule.title}`,
        description: `Shown by /rules as rule ${index + 1}.`,
        fields: [
          { id: 'title', label: 'Title', style: 'short', maxLength: 200, default: rule.title },
          {
            id: 'description',
            label: 'Description',
            style: 'paragraph',
            // Rules render as embed fields, whose values cap at 1024 chars.
            maxLength: 1024,
            default: rule.description,
            required: false,
          },
        ],
      } satisfies ManagedContentEntry,
    ]),
  ),
}

interface ManagedContentConfig {
  allowedRoleKeys: string[]
}

const rawConfig = (Config.managedContent ?? {}) as Partial<ManagedContentConfig>

/** Role config keys (see `config.roles`) allowed to run `/content`. */
export const ManagedContentAllowedRoleKeys: string[] = Array.isArray(rawConfig.allowedRoleKeys)
  ? rawConfig.allowedRoleKeys
  : []
