import { IsDefined, IsIn, IsString, IsUrl, Length } from 'class-validator'
import { ActivityType } from 'discord.js'

export const PresenceActivityTypes = {
  Playing: ActivityType.Playing,
  Streaming: ActivityType.Streaming,
  Listening: ActivityType.Listening,
  Watching: ActivityType.Watching,
  Competing: ActivityType.Competing,
} as const

export class SetPresenceRequest {
  @IsDefined()
  @IsIn(Object.keys(PresenceActivityTypes))
  type: keyof typeof PresenceActivityTypes

  @IsDefined()
  @IsString()
  @Length(1, 128)
  name: string

  @IsDefined()
  @IsUrl()
  url: string
}
