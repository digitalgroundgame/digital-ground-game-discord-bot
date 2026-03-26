export type ParsedGoogleCredentials =
  | { kind: 'service_account'; credentials: Record<string, unknown> }
  | { kind: 'oauth_client'; clientId: string; clientSecret: string }

export function parseGoogleCredentialsJson(json: unknown): ParsedGoogleCredentials | null {
  if (json === null || typeof json !== 'object') {
    return null
  }
  const o = json as Record<string, unknown>

  if (o.type === 'service_account') {
    if (typeof o.client_email === 'string' && typeof o.private_key === 'string') {
      return { kind: 'service_account', credentials: o }
    }
    return null
  }

  if (typeof o.client_email === 'string' && typeof o.private_key === 'string') {
    return { kind: 'service_account', credentials: o }
  }

  const installed = o.installed as Record<string, unknown> | undefined
  const web = o.web as Record<string, unknown> | undefined
  const block = installed ?? web
  if (!block) {
    return null
  }
  const clientId = block.client_id
  const clientSecret = block.client_secret
  if (typeof clientId !== 'string' || typeof clientSecret !== 'string') {
    return null
  }
  return { kind: 'oauth_client', clientId, clientSecret }
}
