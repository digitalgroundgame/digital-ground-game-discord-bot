import { describe, expect, it } from 'vitest'

import { UserService } from '../../src/services/user-service.js'
import { createTestDatabase } from '../helpers/test-database.js'

async function linkGithub(service: UserService, discordUserId: string, login: string) {
  await service.linkAccount(discordUserId, 'github', { externalId: login })
}

describe('UserService.findDiscordUserIdsByGithubLogins', () => {
  it('returns the Discord user IDs linked to the given logins', async () => {
    const service = new UserService(createTestDatabase())
    await linkGithub(service, 'user-1', 'octocat')
    await linkGithub(service, 'user-2', 'hubot')

    const ids = await service.findDiscordUserIdsByGithubLogins(['octocat', 'hubot'])

    expect(ids.sort()).toEqual(['user-1', 'user-2'])
  })

  it('ignores logins nobody linked', async () => {
    const service = new UserService(createTestDatabase())
    await linkGithub(service, 'user-1', 'octocat')

    const ids = await service.findDiscordUserIdsByGithubLogins(['octocat', 'nobody'])

    expect(ids).toEqual(['user-1'])
  })

  it('only matches GitHub links', async () => {
    const service = new UserService(createTestDatabase())
    await service.linkAccount('user-1', 'google', { externalId: 'octocat@example.com' })

    const ids = await service.findDiscordUserIdsByGithubLogins(['octocat@example.com'])

    expect(ids).toEqual([])
  })

  it('returns an empty list for no logins', async () => {
    const service = new UserService(createTestDatabase())
    await linkGithub(service, 'user-1', 'octocat')

    expect(await service.findDiscordUserIdsByGithubLogins([])).toEqual([])
  })

  it('returns each user once', async () => {
    const service = new UserService(createTestDatabase())
    await linkGithub(service, 'user-1', 'octocat')

    const ids = await service.findDiscordUserIdsByGithubLogins(['octocat', 'octocat'])

    expect(ids).toEqual(['user-1'])
  })
})
