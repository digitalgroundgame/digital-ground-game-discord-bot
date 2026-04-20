import { type ShardingManager } from 'discord.js'
import { type Request, type Response } from 'express'
import { createRequire } from 'node:module'

import { isObject } from 'class-validator'
import { Logger } from '../services/logger.js'
import { type Integration } from './integration.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

interface PPArticleAuthor {
  name: string
}

interface PPArticle {
  name: string
  slug: string
  authors: PPArticleAuthor[]
}

interface PPPublishPayload {
  volumeNumber?: number
  title?: string
  articles: PPArticle[]
}

interface BasePPEvent {
  event: string
  payload: unknown
}

interface PPPublishEvent {
  event: 'publish'
  payload: PPPublishPayload
}

type PPEvent = PPPublishEvent

export class PragmaticPapersIntegration implements Integration {
  public name: string = Config.integrations.pragmaticPapers.name
  public publishChannelId: string = Config.integrations.pragmaticPapers.publishChannelId
  public endpoint: string = '/pp-event'

  public async run(req: Request, res: Response, shardManager: ShardingManager): Promise<void> {
    const event = req.body as PPEvent
    if (!event || typeof event.event !== 'string') {
      res.status(400).json({ error: true, message: "Missing 'event' field." })
      return
    }

    try {
      if (event.event === 'publish') {
        const err = this.validatePublishEvent(event)
        if (err) {
          res.status(400).json({ error: true, message: (err as Error).message })
          return
        }

        await this.handlePublish(event.payload, shardManager)
        res.status(200).json({ error: false, event })
        return
      }
    } catch (err) {
      Logger.error((err as Error).message)
      res.status(500).json({ error: true, message: 'Server error occurred' })
      return
    }

    res.status(400).json({ error: true, message: `unhandled event '${event.event}'.` })
  }

  private validatePublishEvent(event: BasePPEvent): TypeError | null {
    const publishEvent = event as PPPublishEvent

    if (!publishEvent.payload) {
      return new TypeError('publish event does not contain a payload')
    }

    if (
      publishEvent.payload.volumeNumber !== undefined &&
      typeof publishEvent.payload.volumeNumber !== 'number'
    ) {
      return new TypeError(
        `volumeNumber must be a valid number if provided, got: ${publishEvent.payload.volumeNumber}`,
      )
    }

    if (
      publishEvent.payload.title !== undefined &&
      typeof publishEvent.payload.title !== 'string'
    ) {
      return new TypeError(
        `title must be a valid string if provided, got: ${publishEvent.payload.title}`,
      )
    }

    if (!Array.isArray(publishEvent.payload.articles)) {
      return new TypeError(`articles must be an array, got: ${publishEvent.payload.articles}`)
    }

    if (
      publishEvent.payload.volumeNumber === undefined &&
      publishEvent.payload.articles.length !== 1
    ) {
      return new TypeError(
        `articles must contain exactly one article when volumeNumber is not provided, got: ${publishEvent.payload.articles.length}`,
      )
    }

    const articles = publishEvent.payload.articles
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i]
      if (!isObject(article)) {
        return new TypeError(`articles[${i}] must be an object, with name and slug fields`)
      }
      if (typeof article.name !== 'string') {
        return new TypeError(`articles[${i}].name must be a valid string, got: ${article?.name}`)
      }
      if (typeof article.slug !== 'string') {
        return new TypeError(`articles[${i}].slug must be a valid string, got: ${article.slug}`)
      }
    }

    return null
  }

  private async handlePublish(
    payload: PPPublishPayload,
    shardManager: ShardingManager,
  ): Promise<void> {
    const ppAuthor = {
      name: 'Pragmatic Papers',
      icon_url: 'https://pragmaticpapers.com/favicon-32x32.png',
      url: 'https://pragmaticpapers.com',
    }

    let embed
    if (payload.volumeNumber === undefined) {
      const article = payload.articles[0]!
      const byStr = article.authors.map(({ name }) => name).join(', ')
      embed = {
        color: 0x1a1a1a,
        title: article.name,
        url: `https://pragmaticpapers.com/articles/${article.slug}`,
        description: `by ${byStr}`,
        author: ppAuthor,
        timestamp: new Date().toISOString(),
      }
    } else {
      const articleList = payload.articles
        .map((art) => {
          const byStr = art.authors.map(({ name }) => name).join(', ')
          return `• [${art.name} by ${byStr}](https://pragmaticpapers.com/articles/${art.slug})`
        })
        .join('\n')
      embed = {
        color: 0x1a1a1a,
        title: payload.title
          ? `Volume ${payload.volumeNumber} — ${payload.title}`
          : `Volume ${payload.volumeNumber}`,
        url: `https://pragmaticpapers.com/volumes/${payload.volumeNumber}`,
        author: ppAuthor,
        fields: [{ name: 'Articles in this Volume', value: articleList }],
        timestamp: new Date().toISOString(),
      }
    }

    await shardManager.broadcastEval(
      async (client, ctx) => {
        const channel = client.channels.cache.get(ctx.channelId)
        if (channel?.isTextBased() && !channel.isDMBased()) {
          await channel.send({ embeds: [ctx.embed] })
          return true
        }
        return false
      },
      { context: { channelId: this.publishChannelId, embed } },
    )
  }
}
