import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GoogleGroupsService } from '../../src/services/google-groups-service.js'

const mocks = vi.hoisted(() => ({
  membersList: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: class {
        constructor(public readonly options: unknown) {}
      },
    },
    admin: () => ({ members: { list: mocks.membersList } }),
  },
}))

vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }))

/** A service whose lazily-built Directory client resolves to the mocked `members.list`. */
function createService(): GoogleGroupsService {
  return new GoogleGroupsService('/tmp/creds.json', 'admin@example.org')
}

function page(
  members: { email?: string | null; type?: string }[],
  nextPageToken?: string,
): { data: { members: typeof members; nextPageToken?: string } } {
  return { data: { members, nextPageToken } }
}

describe('GoogleGroupsService.listMemberEmails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readFile.mockResolvedValue(
      JSON.stringify({
        type: 'service_account',
        client_email: 'bot@example.iam.gserviceaccount.com',
        private_key: 'key',
      }),
    )
  })

  it('returns nothing but a not-configured status without credentials', async () => {
    const service = new GoogleGroupsService(undefined, undefined)

    expect(await service.listMemberEmails('welcome@example.org')).toEqual({
      status: 'not-configured',
    })
    expect(mocks.membersList).not.toHaveBeenCalled()
  })

  it('asks for flattened membership in pages', async () => {
    mocks.membersList.mockResolvedValueOnce(page([{ email: 'a@example.org' }]))

    await createService().listMemberEmails('welcome@example.org')

    expect(mocks.membersList).toHaveBeenCalledWith({
      groupKey: 'welcome@example.org',
      maxResults: 200,
      includeDerivedMembership: true,
      pageToken: undefined,
    })
  })

  it('follows pagination to the end of the list', async () => {
    mocks.membersList
      .mockResolvedValueOnce(page([{ email: 'a@example.org' }], 'page-2'))
      .mockResolvedValueOnce(page([{ email: 'b@example.org' }]))

    const result = await createService().listMemberEmails('welcome@example.org')

    expect(result).toEqual({ status: 'ok', emails: ['a@example.org', 'b@example.org'] })
    expect(mocks.membersList).toHaveBeenCalledTimes(2)
    expect(mocks.membersList).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageToken: 'page-2' }),
    )
  })

  it('trims and lowercases addresses', async () => {
    mocks.membersList.mockResolvedValueOnce(page([{ email: '  Mixed.Case@Example.ORG ' }]))

    expect(await createService().listMemberEmails('welcome@example.org')).toEqual({
      status: 'ok',
      emails: ['mixed.case@example.org'],
    })
  })

  it('skips nested groups and members without an address', async () => {
    mocks.membersList.mockResolvedValueOnce(
      page([
        { email: 'person@example.org', type: 'USER' },
        { email: 'nested@example.org', type: 'GROUP' },
        { email: null, type: 'CUSTOMER' },
      ]),
    )

    expect(await createService().listMemberEmails('welcome@example.org')).toEqual({
      status: 'ok',
      emails: ['person@example.org'],
    })
  })

  it('returns an empty list for an empty group', async () => {
    mocks.membersList.mockResolvedValueOnce({ data: {} })

    expect(await createService().listMemberEmails('welcome@example.org')).toEqual({
      status: 'ok',
      emails: [],
    })
  })

  it('reports an API failure as an error result rather than throwing', async () => {
    mocks.membersList.mockRejectedValueOnce(new Error('Not Authorized'))

    const result = await createService().listMemberEmails('welcome@example.org')

    expect(result.status).toBe('error')
    expect(result).toMatchObject({ message: expect.stringContaining('Not Authorized') })
  })
})
