import { google, type admin_directory_v1 } from 'googleapis'
import { readFile } from 'node:fs/promises'

import { GOOGLE_DIRECTORY_SCOPES } from '../constants/index.js'
import { parseServiceAccountCredentialsJson } from '../utils/parse-google-calendar-credentials.js'
import { Logger } from './logger.js'

function formatGoogleApiError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as Readonly<{
      message?: string
      code?: string | number
      response?: Readonly<{ status?: number; data?: unknown }>
    }>
    const parts: string[] = []
    if (e.message) parts.push(e.message)
    if (e.code !== undefined) parts.push(`code=${String(e.code)}`)
    if (e.response?.status !== undefined) parts.push(`http=${String(e.response.status)}`)
    if (e.response?.data !== undefined) {
      try {
        parts.push(`data=${JSON.stringify(e.response.data)}`)
      } catch {
        parts.push('data=<unserializable>')
      }
    }
    if (parts.length > 0) return parts.join(' | ')
  }
  if (err instanceof Error) return err.message
  return String(err)
}

function statusCodeOf(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const e = err as Readonly<{ code?: string | number; response?: { status?: number } }>
    if (typeof e.code === 'number') return e.code
    if (typeof e.response?.status === 'number') return e.response.status
  }
  return undefined
}

export type AddMemberResult =
  | { status: 'added' }
  | { status: 'already-member' }
  | { status: 'not-configured' }
  | { status: 'error'; message: string }

/**
 * Adds members to Google Workspace groups via the Admin SDK Directory API.
 *
 * Managing group membership requires a service account with domain-wide delegation,
 * impersonating a Workspace admin (`adminSubject`) and granted the
 * `admin.directory.group.member` scope.
 */
export class GoogleGroupsService {
  private admin: admin_directory_v1.Admin | null = null
  private credentialsPath: string | undefined
  private adminSubject: string | undefined
  private initPromise: Promise<void> | null = null

  /**
   * @param credentialsPath Path to a service account JSON key from Google Cloud.
   * @param adminSubject Workspace admin email the service account impersonates (domain-wide
   *   delegation). Required — the Directory API rejects raw service account identities.
   */
  constructor(credentialsPath: string | undefined, adminSubject: string | undefined) {
    this.credentialsPath = credentialsPath?.trim() || undefined
    this.adminSubject = adminSubject?.trim() || undefined
  }

  /** True when credentials path and impersonation subject are both set. */
  public isConfigured(): boolean {
    return this.credentialsPath !== undefined && this.adminSubject !== undefined
  }

  /** Load credentials and construct the API client. Returns false if it cannot be initialized. */
  public async ensureInitialized(): Promise<boolean> {
    await this.ensureClient()
    if (!this.admin) {
      Logger.error(
        'Google Groups: client is not initialized. Check the service account credentials path and GOOGLE_WORKSPACE_ADMIN_SUBJECT (must be a Workspace admin with domain-wide delegation granted for the admin.directory.group.member scope).',
      )
      return false
    }
    return true
  }

  private async ensureClient(): Promise<void> {
    if (this.admin) return
    if (!this.credentialsPath || !this.adminSubject) return
    if (this.initPromise) {
      await this.initPromise
      return
    }
    this.initPromise = this.initClient(this.credentialsPath, this.adminSubject)
    await this.initPromise
  }

  private async initClient(credentialsPath: string, adminSubject: string): Promise<void> {
    try {
      const raw = await readFile(credentialsPath, 'utf-8')
      const json: unknown = JSON.parse(raw)
      const credentials = parseServiceAccountCredentialsJson(json)
      if (!credentials) {
        Logger.error(
          'Google Groups: credentials JSON must be a service account key (type service_account with client_email and private_key).',
        )
        return
      }
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: [...GOOGLE_DIRECTORY_SCOPES],
        clientOptions: { subject: adminSubject },
      })
      this.admin = google.admin({ version: 'directory_v1', auth })
    } catch (err: unknown) {
      Logger.error(
        `Google Groups: failed to read or parse credentials at ${credentialsPath}: ${formatGoogleApiError(err)}`,
        err,
      )
      this.admin = null
    }
  }

  /**
   * Add `memberEmail` to the group identified by `groupEmail`.
   * Treats an existing membership as success.
   */
  public async addMember(groupEmail: string, memberEmail: string): Promise<AddMemberResult> {
    await this.ensureClient()
    if (!this.admin) return { status: 'not-configured' }
    try {
      await this.admin.members.insert({
        groupKey: groupEmail,
        requestBody: { email: memberEmail, role: 'MEMBER' },
      })
      return { status: 'added' }
    } catch (err: unknown) {
      // 409 Conflict — member already belongs to the group.
      if (statusCodeOf(err) === 409) {
        return { status: 'already-member' }
      }
      const message = formatGoogleApiError(err)
      Logger.error(
        `Google Groups: members.insert failed for ${memberEmail} -> ${groupEmail}: ${message}`,
        err,
      )
      return { status: 'error', message }
    }
  }
}
