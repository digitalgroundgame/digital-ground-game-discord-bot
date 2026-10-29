import { type Awaitable, type Client, type Serialized, type ShardingManager } from 'discord.js'

/**
 * Runs `script` on a single shard: the first ready one this manager owns, falling back to the
 * first it owns when none has reported ready yet. `client.users.fetch()` succeeds on every shard,
 * so an unpinned broadcast would run a per-user script once per shard — one DM per shard, for a
 * send.
 *
 * Rejects when no shard is running at all (startup, or all shards respawning), and when the shard
 * has not answered within `timeoutMs`.
 */
export async function evalOnOneShard<Result, Context>(
  shardManager: ShardingManager,
  script: (client: Client<true>, context: Serialized<Context>) => Awaitable<Result>,
  context: Context,
  timeoutMs: number,
): Promise<Serialized<Result>> {
  const shard = shardManager.shards.find(({ ready }) => ready)?.id ?? shardManager.shards.firstKey()

  if (shard == null) {
    throw new Error('No local shard is running.')
  }

  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    shardManager.broadcastEval(script, { shard, context }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Shard ${shard} did not answer within ${timeoutMs}ms.`)),
        timeoutMs,
      )
    }),
  ]).finally(() => clearTimeout(timer))
}
