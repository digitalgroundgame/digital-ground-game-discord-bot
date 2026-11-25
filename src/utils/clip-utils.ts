export type ClipPlatform = 'youtube' | 'twitch' | 'other'

/** A submitted clip link, classified by platform. */
export interface ParsedClipUrl {
  url: URL
  platform: ClipPlatform
  /** Set for YouTube and Twitch links. */
  videoId?: string
  /** Start time carried by the link's `t` parameter, in seconds. */
  linkSeconds?: number
}

// `H:MM:SS` or `M:SS`; range checks happen after matching.
const COLON_PATTERN = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/
// `1h2m3s`, `45m`, `90s`, `3723s`; at least one group must be present.
const UNIT_PATTERN = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i
const SECONDS_PATTERN = /^\d+$/
const YOUTUBE_ID_PATTERN = /^[\w-]+$/
const TWITCH_ID_PATTERN = /^\d+$/

export class ClipUtils {
  /**
   * Parses a timestamp typed by a member or carried in a link's `t`
   * parameter. Returns whole seconds, or null if the input matches none of
   * the accepted formats.
   */
  public static parseTimestamp(input: string): number | null {
    const value = input.trim()

    const colon = value.match(COLON_PATTERN)
    if (colon) {
      const [, first, second, third] = colon
      if (third === undefined) {
        // M:SS: minutes may run past 59 (e.g. `62:03`).
        const seconds = Number(second)
        if (seconds >= 60) return null
        return ClipUtils.safe(Number(first) * 60 + seconds)
      }
      const minutes = Number(second)
      const seconds = Number(third)
      if (minutes >= 60 || seconds >= 60) return null
      return ClipUtils.safe(Number(first) * 3600 + minutes * 60 + seconds)
    }

    if (SECONDS_PATTERN.test(value)) {
      return ClipUtils.safe(Number(value))
    }

    const unit = value.match(UNIT_PATTERN)
    if (unit) {
      const [, hours, minutes, seconds] = unit
      if (hours === undefined && minutes === undefined && seconds === undefined) return null
      return ClipUtils.safe(
        Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0),
      )
    }

    return null
  }

  /** Formats seconds as `H:MM:SS` when there are hours, `M:SS` otherwise. */
  public static formatTimestamp(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    const ss = String(seconds).padStart(2, '0')
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`
    }
    return `${minutes}:${ss}`
  }

  /**
   * Parses a submitted link. Returns null unless it is an absolute `http`
   * or `https` URL. YouTube video and Twitch VOD links are classified so a
   * deep link can be built; anything else is `other`.
   */
  public static parseClipUrl(input: string): ParsedClipUrl | null {
    let url: URL
    try {
      url = new URL(input.trim())
    } catch {
      return null
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }

    const t = url.searchParams.get('t')
    const linkSeconds = t === null ? undefined : (ClipUtils.parseTimestamp(t) ?? undefined)

    const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '')
    const segments = url.pathname.split('/').filter(Boolean)

    const youtubeId = ClipUtils.youtubeVideoId(host, url, segments)
    if (youtubeId) {
      return { url, platform: 'youtube', videoId: youtubeId, linkSeconds }
    }

    if (
      host === 'twitch.tv' &&
      segments[0] === 'videos' &&
      segments[1] &&
      TWITCH_ID_PATTERN.test(segments[1])
    ) {
      return { url, platform: 'twitch', videoId: segments[1], linkSeconds }
    }

    return { url, platform: 'other', linkSeconds }
  }

  /**
   * Builds the link to post. YouTube and Twitch links are rebuilt in
   * canonical form opening at `startSeconds`; other links are kept as given.
   */
  public static buildDeepLink(parsed: ParsedClipUrl, startSeconds: number): string {
    switch (parsed.platform) {
      case 'youtube': {
        return `https://www.youtube.com/watch?v=${parsed.videoId}&t=${startSeconds}s`
      }
      case 'twitch': {
        const hours = Math.floor(startSeconds / 3600)
        const minutes = Math.floor((startSeconds % 3600) / 60)
        const seconds = startSeconds % 60
        return `https://www.twitch.tv/videos/${parsed.videoId}?t=${hours}h${minutes}m${seconds}s`
      }
      default: {
        return parsed.url.href
      }
    }
  }

  private static youtubeVideoId(host: string, url: URL, segments: string[]): string | undefined {
    let id: string | null | undefined
    if (host === 'youtu.be') {
      id = segments[0]
    } else if (host === 'youtube.com') {
      if (segments[0] === 'watch') {
        id = url.searchParams.get('v')
      } else if (segments[0] === 'live' || segments[0] === 'shorts') {
        id = segments[1]
      }
    }
    return id && YOUTUBE_ID_PATTERN.test(id) ? id : undefined
  }

  /** Rejects inputs too large to represent exactly (e.g. a 30-digit number). */
  private static safe(seconds: number): number | null {
    return Number.isSafeInteger(seconds) ? seconds : null
  }
}
