/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChannelType, PermissionFlagsBits } from 'discord.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ClipCommand } from '../../src/commands/chat/clip-command.js'
import { ChatCommandMetadata, CommandDeferType } from '../../src/commands/index.js'
import { Language } from '../../src/models/enum-helpers/index.js'
import { EventData } from '../../src/models/internal-models.js'
import { Lang } from '../../src/services/lang.js'
import { Logger } from '../../src/services/logger.js'
import {
  createMockCommandInteraction,
  createMockGuildChannel,
  createMockThreadChannel,
  createMockUser,
} from '../helpers/discord-mocks.js'

const GUILD_ID = '111222333444555666'
const OTHER_GUILD_ID = '666555444333222111'
const CHANNEL_ID = '444555666777888999'
const SUBMITTER_ID = '123456789012345678'
const data = new EventData(Language.Default, Language.Default)

type Options = { url?: string; start?: string; end?: string; note?: string }

function permissions(granted: boolean | ((perms: bigint[]) => boolean) = true): any {
  return vi.fn().mockReturnValue({
    has: vi.fn((perms: bigint[]) => (typeof granted === 'function' ? granted(perms) : granted)),
  })
}

function textChannel(overrides: any = {}): any {
  return createMockGuildChannel({
    id: CHANNEL_ID,
    name: 'clip-suggestions',
    guildId: GUILD_ID,
    type: ChannelType.GuildText,
    permissionsFor: permissions(),
    send: vi.fn().mockResolvedValue({ url: 'https://discord.com/channels/1/2/message' }),
    ...overrides,
  })
}

function forumChannel(overrides: any = {}): any {
  return createMockGuildChannel({
    id: CHANNEL_ID,
    name: 'clip-suggestions',
    guildId: GUILD_ID,
    type: ChannelType.GuildForum,
    permissionsFor: permissions(),
    threads: { create: vi.fn().mockResolvedValue({ url: 'https://discord.com/channels/1/post' }) },
    ...overrides,
  })
}

function threadChannel(overrides: any = {}): any {
  return createMockThreadChannel({
    id: CHANNEL_ID,
    name: 'clip-megathread',
    guildId: GUILD_ID,
    type: ChannelType.PublicThread,
    locked: false,
    archived: false,
    permissionsFor: permissions(),
    send: vi.fn().mockResolvedValue({ url: 'https://discord.com/channels/1/thread/message' }),
    ...overrides,
  })
}

function createInteraction(options: Options, destination: any): any {
  const values: Record<string, string | undefined> = {
    url: 'https://www.youtube.com/watch?v=abc123',
    ...options,
  }
  return createMockCommandInteraction({
    user: createMockUser({ id: SUBMITTER_ID, tag: 'submitter' }),
    guild: { id: GUILD_ID, name: 'Test Guild' },
    deferred: true,
    client: {
      user: { id: '987654321098765432' },
      channels: {
        fetch:
          destination instanceof Error
            ? vi.fn().mockRejectedValue(destination)
            : vi.fn().mockResolvedValue(destination),
      },
    },
    options: {
      getString: vi.fn((name: string) => values[name] ?? null),
    },
  })
}

async function run(
  options: Options,
  destination: any = textChannel(),
  command = new ClipCommand({ channelId: CHANNEL_ID }),
) {
  const intr = createInteraction(options, destination)
  await command.execute(intr, data)
  const reply = intr.editReply.mock.calls[0]?.[0]?.embeds?.[0]?.data
  return { intr, reply }
}

function sentPayload(channel: any): any {
  return channel.send.mock.calls[0]?.[0]
}

function fieldValue(embed: any, name: string): string | undefined {
  return embed.data.fields?.find((field: any) => field.name === name)?.value
}

describe('ClipCommand', () => {
  let loggerError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    loggerError = vi.spyOn(Logger, 'error').mockResolvedValue()
    vi.spyOn(Logger, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('replies privately and is open to everyone by default', () => {
    const command = new ClipCommand({ channelId: CHANNEL_ID, allowedRoleIds: [] })
    expect(command.deferType).toBe(CommandDeferType.HIDDEN)
    expect(command.requireRoles).toEqual([])
    expect(command.cooldown).toBeDefined()
  })

  it('is registered as a guild-only command with url required', () => {
    const metadata = ChatCommandMetadata.CLIP
    expect(metadata?.name).toBe('clip')
    expect(metadata?.dm_permission).toBe(false)
    expect(metadata?.options?.map((option: any) => [option.name, option.required])).toEqual([
      ['url', true],
      ['start', false],
      ['end', false],
      ['note', false],
    ])
  })

  it('resolves every lang key it uses', () => {
    const refs = [
      'chatCommands.clip',
      'commandDescs.clip',
      'arguments.url',
      'arguments.start',
      'arguments.end',
      'arguments.note',
      'argDescs.clipUrl',
      'argDescs.clipStart',
      'argDescs.clipEnd',
      'argDescs.clipNote',
      'clipSuggestion.titleYoutube',
      'clipSuggestion.titleTwitch',
      'clipSuggestion.titleOther',
      'clipSuggestion.start',
      'clipSuggestion.end',
      'clipSuggestion.length',
      'clipSuggestion.link',
      'clipSuggestion.submittedBy',
      'clipSuggestion.range',
      'clipSuggestion.postTitle',
      'clipSuggestion.postTitleNoNote',
    ]
    for (const ref of refs) {
      expect(Lang.getRef(ref, Language.Default), ref).toBeTruthy()
    }
    const embeds = [
      'clipSubmitted',
      'clipNotConfigured',
      'clipDeliveryFailed',
      'clipInvalidUrl',
      'clipMissingStart',
      'clipInvalidTime',
      'clipEndBeforeStart',
    ]
    for (const embed of embeds) {
      expect(
        Lang.getEmbed(`displayEmbeds.${embed}`, Language.Default).data.description,
        embed,
      ).toBeTruthy()
    }
  })

  describe('delivery', () => {
    it('posts to a text channel and links the submitter to it', async () => {
      const channel = textChannel()
      const { reply } = await run(
        { start: '1:02:03', end: '1:03:13', note: 'Destiny reacts to the debate' },
        channel,
      )

      const payload = sentPayload(channel)
      const embed = payload.embeds[0]
      expect(embed.data.title).toBe('YouTube clip suggestion')
      expect(embed.data.url).toBe('https://www.youtube.com/watch?v=abc123&t=3723s')
      expect(embed.data.description).toBe('Destiny reacts to the debate')
      expect(fieldValue(embed, 'Start')).toBe('1:02:03')
      expect(fieldValue(embed, 'End')).toBe('1:03:13')
      expect(fieldValue(embed, 'Length')).toBe('1:10')
      expect(fieldValue(embed, 'Link')).toBe('https://www.youtube.com/watch?v=abc123&t=3723s')
      expect(fieldValue(embed, 'Submitted by')).toBe(`<@${SUBMITTER_ID}>`)
      expect(reply.description).toContain('https://discord.com/channels/1/2/message')
    })

    it('shows only the start time when no end is given', async () => {
      const channel = textChannel()
      await run({ start: '45' }, channel)

      const embed = sentPayload(channel).embeds[0]
      expect(fieldValue(embed, 'Start')).toBe('0:45')
      expect(fieldValue(embed, 'End')).toBeUndefined()
      expect(fieldValue(embed, 'Length')).toBeUndefined()
      expect(embed.data.description).toBeUndefined()
    })

    it('posts to an announcement channel', async () => {
      const channel = textChannel({ type: ChannelType.GuildAnnouncement })
      await run({ start: '10' }, channel)
      expect(channel.send).toHaveBeenCalledOnce()
    })

    it('creates one forum post per suggestion, titled with the time and note', async () => {
      const channel = forumChannel()
      const { reply } = await run({ start: '1:02:03', note: 'Big moment' }, channel)

      const create = channel.threads.create.mock.calls[0]?.[0]
      expect(create.name).toBe('Big moment @ 1:02:03')
      expect(create.message.embeds[0].data.url).toContain('t=3723s')
      expect(create.message.allowedMentions).toEqual({ parse: [] })
      expect(reply.description).toContain('https://discord.com/channels/1/post')
    })

    it('titles a forum post without a note by its time range', async () => {
      const channel = forumChannel()
      await run({ start: '1:02:03', end: '1:03:13' }, channel)
      expect(channel.threads.create.mock.calls[0]?.[0].name).toBe('Clip @ 1:02:03 - 1:03:13')
    })

    it('shortens a long note so the forum post title fits', async () => {
      const channel = forumChannel()
      await run({ start: '1:02:03', note: 'x'.repeat(500) }, channel)

      const name: string = channel.threads.create.mock.calls[0]?.[0].name
      expect(name.length).toBeLessThanOrEqual(100)
      expect(name.endsWith('... @ 1:02:03')).toBe(true)
    })

    it('posts into a megathread without creating a new post', async () => {
      const channel = threadChannel()
      const { reply } = await run({ start: '1:00' }, channel)

      expect(channel.send).toHaveBeenCalledOnce()
      expect(channel.threads).toBeUndefined()
      expect(reply.description).toContain('https://discord.com/channels/1/thread/message')
    })

    it('still delivers to an archived, unlocked thread', async () => {
      const channel = threadChannel({ archived: true })
      await run({ start: '1:00' }, channel)
      expect(channel.send).toHaveBeenCalledOnce()
    })

    it('never lets the note notify anyone', async () => {
      const channel = textChannel()
      await run({ start: '1:00', note: '@everyone look <@222333444555666777>' }, channel)
      expect(sentPayload(channel).allowedMentions).toEqual({ parse: [] })
    })

    it('replies that suggestions are not set up when no channel is configured', async () => {
      const channel = textChannel()
      const { intr, reply } = await run(
        { start: '1:00' },
        channel,
        new ClipCommand({ channelId: undefined }),
      )

      expect(reply.description).toContain("aren't set up yet")
      expect(intr.client.channels.fetch).not.toHaveBeenCalled()
      expect(channel.send).not.toHaveBeenCalled()
    })

    // [case, destination, whether the bot should get as far as sending]
    const failures: [string, () => any, boolean][] = [
      ['a locked thread', () => threadChannel({ locked: true }), false],
      ['a channel in another guild', () => textChannel({ guildId: OTHER_GUILD_ID }), false],
      ['an unknown channel', () => null, false],
      ['a voice channel', () => textChannel({ type: ChannelType.GuildVoice }), false],
      [
        'a text channel without send permission',
        () => textChannel({ permissionsFor: permissions(false) }),
        false,
      ],
      [
        'a forum without permissions',
        () => forumChannel({ permissionsFor: permissions(false) }),
        false,
      ],
      [
        'a forum that rejects the post',
        () => forumChannel({ threads: { create: vi.fn().mockRejectedValue(new Error('tags')) } }),
        true,
      ],
      ['a channel fetch that throws', () => new Error('Discord unavailable'), false],
      [
        'a send that is rejected',
        () => textChannel({ send: vi.fn().mockRejectedValue(new Error('Missing Access')) }),
        true,
      ],
    ]

    it.each(failures)(
      'reports and logs a delivery failure for %s',
      async (_, destination, attemptsSend) => {
        const channel = destination()
        const { reply } = await run({ start: '1:00' }, channel)

        expect(reply.description).toContain("couldn't be delivered")
        expect(loggerError).toHaveBeenCalledOnce()
        const send = channel?.send ?? channel?.threads?.create
        if (send) expect(send.mock.calls.length).toBe(attemptsSend ? 1 : 0)
      },
    )

    it('requires Send Messages in Threads for a thread destination', async () => {
      const channel = threadChannel({
        permissionsFor: permissions(
          (perms) => !perms.includes(PermissionFlagsBits.SendMessagesInThreads),
        ),
      })
      const { reply } = await run({ start: '1:00' }, channel)

      expect(reply.description).toContain("couldn't be delivered")
      expect(channel.send).not.toHaveBeenCalled()
    })
  })

  describe('validation', () => {
    it('accepts a timestamped link on its own', async () => {
      const channel = textChannel()
      await run({ url: 'https://www.youtube.com/watch?v=abc123&t=1h2m3s' }, channel)
      expect(fieldValue(sentPayload(channel).embeds[0], 'Start')).toBe('1:02:03')
    })

    it('lets an explicit start override the link', async () => {
      const channel = textChannel()
      await run({ url: 'https://youtu.be/abc123?t=600', start: '12:00' }, channel)

      const embed = sentPayload(channel).embeds[0]
      expect(fieldValue(embed, 'Start')).toBe('12:00')
      expect(embed.data.url).toBe('https://www.youtube.com/watch?v=abc123&t=720s')
    })

    it('posts other links as given', async () => {
      const channel = textChannel()
      await run({ url: 'https://rumble.com/v123-some-stream.html', start: '45:00' }, channel)

      const embed = sentPayload(channel).embeds[0]
      expect(embed.data.title).toBe('Clip suggestion')
      expect(embed.data.url).toBe('https://rumble.com/v123-some-stream.html')
      expect(fieldValue(embed, 'Start')).toBe('45:00')
    })

    it.each<[string, Options, string]>([
      [
        'an invalid URL',
        { url: 'watch the destiny stream', start: '1:00' },
        "doesn't look like a video link",
      ],
      [
        'a non-web URL',
        { url: 'javascript:alert(1)', start: '1:00' },
        "doesn't look like a video link",
      ],
      ['no start time anywhere', {}, 'Add a `start` time'],
      ['an unreadable start', { start: 'about an hour in' }, "couldn't read the `start` time"],
      ['an unreadable end', { start: '1:00', end: '1:75:00' }, "couldn't read the `end` time"],
      ['an end equal to the start', { start: '1:00', end: '60' }, 'must be after the start time'],
      ['an end before the start', { start: '2:00', end: '1:00' }, 'must be after the start time'],
    ])('rejects %s without posting', async (_, options, message) => {
      const channel = textChannel()
      const { intr, reply } = await run(options, channel)

      expect(reply.description).toContain(message)
      expect(intr.client.channels.fetch).not.toHaveBeenCalled()
      expect(channel.send).not.toHaveBeenCalled()
    })
  })
})
