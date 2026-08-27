import { type AccountProvider } from '../database/schema.js'

/** Loose email check — enough to catch obvious typos before storing the link. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * A service a Discord member can link to their account via `/link-account`.
 * Adding a new provider here (and to the `account_provider` DB enum) makes it
 * appear in the command's service drop-down automatically.
 */
export interface LinkableAccount {
  /** Database provider key (see `account_provider` enum). */
  provider: AccountProvider
  /** Human-readable service name shown in the drop-down. */
  label: string
  /** Drop-down option description. */
  description: string
  /** Label for the identifier field in the pop-up form. */
  identifierLabel: string
  /** Placeholder text shown inside the form input. */
  identifierPlaceholder: string
  /** Returns true when the raw identifier the user typed looks valid. */
  validate(identifier: string): boolean
  /** Normalize the raw identifier into the stored external id and email. */
  normalize(identifier: string): { externalId: string; email?: string }
}

export const LinkableAccounts: LinkableAccount[] = [
  {
    provider: 'google',
    label: 'Google',
    description: 'Link your Google account by email address',
    identifierLabel: 'Google account email',
    identifierPlaceholder: 'you@example.com',
    validate: (identifier: string): boolean => EMAIL_REGEX.test(identifier.trim()),
    normalize: (identifier: string): { externalId: string; email?: string } => {
      const email = identifier.trim().toLowerCase()
      return { externalId: email, email }
    },
  },
  {
    provider: 'github',
    label: 'GitHub',
    description: 'Link your GitHub account by username',
    identifierLabel: 'GitHub username',
    identifierPlaceholder: 'your-username',
    // GitHub usernames: alphanumeric or hyphens, no leading/trailing/consecutive hyphens, 1-39 chars.
    validate: (identifier: string): boolean =>
      /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(identifier.trim()),
    normalize: (identifier: string): { externalId: string; email?: string } => {
      const externalId = identifier.trim()
      return { externalId, email: undefined }
    },
  },
]

/** Resolve a provider key to its linkable-account config, or undefined if unknown. */
export function getLinkableAccount(provider: string): LinkableAccount | undefined {
  return LinkableAccounts.find((account) => account.provider === provider)
}
