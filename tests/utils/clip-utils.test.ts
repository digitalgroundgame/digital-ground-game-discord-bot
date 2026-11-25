import { describe, expect, it } from 'vitest'

import { ClipUtils, type ParsedClipUrl } from '../../src/utils/index.js'

function parse(input: string): ParsedClipUrl {
  const parsed = ClipUtils.parseClipUrl(input)
  if (!parsed) throw new Error(`expected ${input} to parse`)
  return parsed
}

describe('ClipUtils', () => {
  describe('parseTimestamp', () => {
    it.each([
      ['1:02:03', 3723],
      ['62:03', 3723],
      ['0:45', 45],
      ['1:2:3', 3723],
      ['1h2m3s', 3723],
      ['1H2M3S', 3723],
      ['45m', 2700],
      ['90s', 90],
      ['1h', 3600],
      ['3723s', 3723],
      ['01h02m03s', 3723],
      ['3723', 3723],
      ['0', 0],
      ['  1:02:03  ', 3723],
    ])('parses %j as %i seconds', (input, expected) => {
      expect(ClipUtils.parseTimestamp(input)).toBe(expected)
    })

    it.each([
      'about an hour in',
      '1:75:00',
      '1:02:75',
      '5:60',
      '',
      '   ',
      '1:02:03:04',
      '1.5',
      '-30',
      '1m2h',
      'h',
      '1h 2m',
      '1'.repeat(30),
    ])('rejects %j', (input) => {
      expect(ClipUtils.parseTimestamp(input)).toBeNull()
    })
  })

  describe('formatTimestamp', () => {
    it.each([
      [3723, '1:02:03'],
      [70, '1:10'],
      [0, '0:00'],
      [59, '0:59'],
      [3600, '1:00:00'],
      [36_005, '10:00:05'],
    ])('formats %i as %j', (seconds, expected) => {
      expect(ClipUtils.formatTimestamp(seconds)).toBe(expected)
    })
  })

  describe('parseClipUrl', () => {
    it.each([
      'https://www.youtube.com/watch?v=abc123',
      'https://youtube.com/watch?v=abc123',
      'https://m.youtube.com/watch?v=abc123&list=PL1',
      'https://youtu.be/abc123',
      'https://www.youtube.com/live/abc123',
      'https://www.youtube.com/shorts/abc123',
      'http://WWW.YOUTUBE.COM/watch?v=abc123',
    ])('classifies %s as YouTube video abc123', (input) => {
      expect(parse(input)).toMatchObject({ platform: 'youtube', videoId: 'abc123' })
    })

    it.each([
      'https://www.twitch.tv/videos/987654',
      'https://twitch.tv/videos/987654?t=1h',
      'https://m.twitch.tv/videos/987654',
    ])('classifies %s as Twitch VOD 987654', (input) => {
      expect(parse(input)).toMatchObject({ platform: 'twitch', videoId: '987654' })
    })

    it.each([
      'https://rumble.com/v123-some-stream.html',
      'https://www.youtube.com/@destiny',
      'https://www.youtube.com/watch',
      'https://www.twitch.tv/destiny',
      'https://www.twitch.tv/videos/not-a-number',
      'https://kick.com/destiny/videos/abc',
    ])('classifies %s as other', (input) => {
      const parsed = parse(input)
      expect(parsed.platform).toBe('other')
      expect(parsed.videoId).toBeUndefined()
    })

    it.each([
      'watch the destiny stream',
      'javascript:alert(1)',
      'ftp://example.com/video',
      'youtube.com/watch?v=abc123',
      '',
    ])('rejects %j', (input) => {
      expect(ClipUtils.parseClipUrl(input)).toBeNull()
    })

    it.each([
      ['https://www.youtube.com/watch?v=abc123&t=3723', 3723],
      ['https://www.youtube.com/watch?v=abc123&t=3723s', 3723],
      ['https://www.youtube.com/watch?v=abc123&t=1h2m3s', 3723],
      ['https://youtu.be/abc123?t=90', 90],
      ['https://www.twitch.tv/videos/987654?t=01h02m03s', 3723],
    ])('reads the start time from %s', (input, expected) => {
      expect(parse(input).linkSeconds).toBe(expected)
    })

    it('leaves linkSeconds unset without a usable t parameter', () => {
      expect(parse('https://youtu.be/abc123').linkSeconds).toBeUndefined()
      expect(parse('https://youtu.be/abc123?t=soon').linkSeconds).toBeUndefined()
    })

    it('trims surrounding whitespace', () => {
      expect(parse('  https://youtu.be/abc123  ')).toMatchObject({ platform: 'youtube' })
    })
  })

  describe('buildDeepLink', () => {
    it('opens a YouTube short link at the start time', () => {
      expect(ClipUtils.buildDeepLink(parse('https://youtu.be/abc123'), 3723)).toBe(
        'https://www.youtube.com/watch?v=abc123&t=3723s',
      )
    })

    it('replaces a different timestamp on a YouTube link', () => {
      expect(
        ClipUtils.buildDeepLink(parse('https://www.youtube.com/watch?v=abc123&t=10'), 300),
      ).toBe('https://www.youtube.com/watch?v=abc123&t=300s')
    })

    it('normalizes YouTube live and shorts links', () => {
      expect(ClipUtils.buildDeepLink(parse('https://www.youtube.com/live/abc123'), 60)).toBe(
        'https://www.youtube.com/watch?v=abc123&t=60s',
      )
      expect(ClipUtils.buildDeepLink(parse('https://youtube.com/shorts/abc123?si=x'), 5)).toBe(
        'https://www.youtube.com/watch?v=abc123&t=5s',
      )
    })

    it('opens a Twitch VOD at the start time in unit form', () => {
      expect(ClipUtils.buildDeepLink(parse('https://www.twitch.tv/videos/987654'), 3723)).toBe(
        'https://www.twitch.tv/videos/987654?t=1h2m3s',
      )
      expect(ClipUtils.buildDeepLink(parse('https://twitch.tv/videos/987654?t=5s'), 300)).toBe(
        'https://www.twitch.tv/videos/987654?t=0h5m0s',
      )
    })

    it('keeps other links as given', () => {
      const input = 'https://rumble.com/v123-some-stream.html'
      expect(ClipUtils.buildDeepLink(parse(input), 2700)).toBe(input)
    })
  })
})
