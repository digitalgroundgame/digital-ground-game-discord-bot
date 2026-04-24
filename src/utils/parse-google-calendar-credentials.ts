/**
 * Parse a Google Cloud **service account** JSON key for use with googleapis.
 * Returns the raw credential object, or null if the file is not a service account key.
 */
export function parseServiceAccountCredentialsJson(json: unknown): Record<string, unknown> | null {
  if (json === null || typeof json !== 'object') {
    return null
  }
  const o = json as Record<string, unknown>

  if (o.type === 'service_account') {
    if (typeof o.client_email === 'string' && typeof o.private_key === 'string') {
      return o
    }
    return null
  }

  if (typeof o.client_email === 'string' && typeof o.private_key === 'string') {
    return o
  }

  return null
}
