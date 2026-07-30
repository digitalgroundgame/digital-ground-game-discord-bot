import { createRequire } from 'node:module'

import { ServerRoles, type RoleKey } from './server-roles.js'

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
  OnboardingDev: 'onboarding-dev',
  OnboardingEvents: 'onboarding-events',
  OnboardingMedia: 'onboarding-media',
  OnboardingResearch: 'onboarding-research',
  OnboardingWelcome: 'onboarding-welcome',
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

const DEV_ONBOARDING_MESSAGE = `
    So you're interested in the **Digital Ground Game Dev Team** — awesome! 👋

    Read the [onboarding doc.](https://docs.google.com/document/d/1ftfaatfO1umsE-ZOLmjfohn4JW-3TnSMkZF3ib9AyO0/edit?usp=sharing)

    Fill out the [interest form.](https://docs.google.com/forms/d/e/1FAIpQLSe1gt1uoDxbUcFL0ETidzto39VFg_fdqPQ8DXQSSG6ITgfCGQ/viewform?usp=sharing&ouid=103918157312606254571)

    Keep up to date by **reading the pinned posts** in **#dev-team.**

    If you have questions, reach out any time in **#dev-team!**

    For more context or an onboarding chat you can ping the Dev Team Lead, **Evan-6seven**.`

const WELCOME_ONBOARDING_MESSAGE = `
    Thanks for joining this team and helping support Digital Ground Game.

    This team focuses on:

    ▫️ Greeting new members and helping them feel welcome
    ▫️ Helping new people navigate the Discord server
    ▫️ Answering basic questions and pointing people to the right teams or resources

    To begin, follow these steps:

    ▫️ Introduce yourself in the Welcome team channel
    ▫️ Check the pinned messages in the welcome team channels for team leads, and resources
    ▫️ Reach out to the team leads and use the designated team chats to coordinate with others.

    If you're unsure where to start, feel free to ask in the team channel, and a welcome team member will help get you settled!

    We're glad to have you on the team!`

const EVENTS_ONBOARDING_MESSAGE = `
    Thanks for joining this team and helping support Digital Ground Game.

    This team focuses on:

    ▫️ Planning and coordinating events
    ▫️ Supporting logistics and volunteer coordination
    ▫️ Helping promote and manage event participation

    To begin, follow these steps:

    ▫️ Introduce yourself in the Events team channel
    ▫️ Check the pinned messages in the Events team channels for team leads, resources, and current projects
    ▫️ Use the designated team chats to coordinate with others, as well as reach out to the Team leads to get started!

    If you're unsure where to start, feel free to ask in the team channel, and an Events team member will help get you settled!

    We're glad to have you on the team!`

const MEDIA_ONBOARDING_MESSAGE = `
    Thanks for joining this team and helping support Digital Ground Game.

    This team focuses on:

    ▫️ Creating social media graphics
    ▫️ Designing visual content for campaigns
    ▫️ Producing digital media that helps communicate our message

    To begin, follow these steps:

    ▫️ Introduce yourself in the Media team channel
    ▫️ Check the pinned messages in the Media team channels for team leads, resources, and current projects
    ▫️ Use the designated team chats to coordinate with others, as well as reach out to the Team leads
    ▫️ Explore the numerous projects available in the Project Board Channel!

    If you're unsure where to start, feel free to ask in the team channel, and a media team member will help get you settled!

    We're glad to have you on the team!`

const RESEARCH_ONBOARDING_MESSAGE = `
    Thanks for joining this team and helping support Digital Ground Game.

    This team focuses on:

    ▫️ Researching candidates, races, and issues
    ▫️ Gathering and organizing useful information
    ▫️ Supporting campaigns with accurate research
    ▫️ Providing Call to Actions weekly for the organization

    To begin, follow these steps:

    ▫️ Introduce yourself in the Research team channel
    ▫️ Check the pinned messages in the Research team channels for team leads, resources, and the current projects
    ▫️ Use the designated team chats to coordinate with others, as well as reach out to the Team leads
    ▫️ Explore the numerous projects available in the Project Board Channel!

    If you're unsure where to start, feel free to ask in the team channel, and a research team member will help get you settled!

    We're glad to have you on the team!`

/** A team onboarding DM: an embed title plus its message body. */
function onboardingEntry(team: string, title: string, message: string): ManagedContentEntry {
  return {
    label: `${team} Onboarding`,
    description: `DMed by the "Send ${team} Onboarding" context menu command.`,
    fields: [
      { id: 'title', label: 'Title', style: 'short', maxLength: 256, default: title },
      { id: 'message', label: 'Message', style: 'paragraph', maxLength: 4000, default: message },
    ],
  }
}

/**
 * Registry of all runtime-editable content. The single source of truth for
 * what `/content` can show/edit; hardcoded defaults live here and are
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
        // Sent as raw message content (thread.send), which Discord caps at
        // 2000 chars — unlike the onboarding entries, which render into an
        // embed description (4096 cap).
        maxLength: 2000,
        default: WELCOME_THREAD_MESSAGE,
      },
    ],
  },
  [ContentKeys.OnboardingDev]: onboardingEntry(
    'Dev Team',
    'About Digital Ground Game Dev Team',
    DEV_ONBOARDING_MESSAGE,
  ),
  [ContentKeys.OnboardingEvents]: onboardingEntry(
    'Events Team',
    'Welcome to the Events Team!',
    EVENTS_ONBOARDING_MESSAGE,
  ),
  [ContentKeys.OnboardingMedia]: onboardingEntry(
    'Media Team',
    'Welcome to the Media Team!',
    MEDIA_ONBOARDING_MESSAGE,
  ),
  [ContentKeys.OnboardingResearch]: onboardingEntry(
    'Research Team',
    'Welcome to the Research Team!',
    RESEARCH_ONBOARDING_MESSAGE,
  ),
  [ContentKeys.OnboardingWelcome]: onboardingEntry(
    'Welcome Team',
    'Welcome to the Welcome Team!',
    WELCOME_ONBOARDING_MESSAGE,
  ),
}

interface ManagedContentConfig {
  allowedRoleKeys: string[]
}

const rawConfig = (Config.managedContent ?? {}) as Partial<ManagedContentConfig>

/**
 * /content is a permission boundary, so its role config fails CLOSED: an
 * empty, missing, or typo'd `managedContent.allowedRoleKeys` refuses to
 * start the bot rather than silently leaving the command unrestricted
 * (an empty `requireRoles` skips the role check entirely).
 */
function validateAllowedRoleKeys(raw: unknown): RoleKey[] {
  const keys = Array.isArray(raw) ? raw.filter((key): key is string => typeof key === 'string') : []
  const validKeys = Object.keys(ServerRoles)

  const unknown = keys.filter((key) => !validKeys.includes(key))
  if (unknown.length > 0) {
    throw new Error(
      `config.managedContent.allowedRoleKeys contains unknown role keys: ${unknown.join(', ')} (valid: ${validKeys.join(', ')})`,
    )
  }
  if (keys.length === 0) {
    throw new Error(
      'config.managedContent.allowedRoleKeys must list at least one role key; an empty list would leave /content open to everyone',
    )
  }
  return keys as RoleKey[]
}

/** Role config keys (see `config.roles`) allowed to run `/content`. */
export const ManagedContentAllowedRoleKeys: RoleKey[] = validateAllowedRoleKeys(
  rawConfig.allowedRoleKeys,
)
