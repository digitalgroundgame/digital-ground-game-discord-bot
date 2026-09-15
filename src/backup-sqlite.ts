import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import Sqlite from 'better-sqlite3'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set`)
  }
  return value
}

async function main(): Promise<void> {
  const databasePath = requiredEnvironment('SQLITE_PATH')
  const bucket = requiredEnvironment('BACKUP_S3_BUCKET')
  const endpoint = requiredEnvironment('BACKUP_S3_ENDPOINT')
  const region = process.env.BACKUP_S3_REGION ?? 'us-east-1'
  const prefix = (process.env.BACKUP_S3_PREFIX ?? 'discord-bot/sqlite').replace(/^\/|\/$/g, '')
  const timestamp = new Date()
    .toISOString()
    .replaceAll(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  const archiveName = `${basename(databasePath, '.sqlite')}-${timestamp}.sqlite.gz`
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'sqlite-backup-'))
  const snapshotPath = join(temporaryDirectory, archiveName.replace(/\.gz$/, ''))
  const archivePath = join(temporaryDirectory, archiveName)

  try {
    const database = new Sqlite(databasePath, { readonly: true })
    try {
      await database.backup(snapshotPath)
    } finally {
      database.close()
    }

    await pipeline(createReadStream(snapshotPath), createGzip(), createWriteStream(archivePath))

    const client = new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
    })
    const key = `${prefix}/${archiveName}`

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: await readFile(archivePath),
        ContentType: 'application/gzip',
      }),
    )

    console.log(`Uploaded s3://${bucket}/${key}`)
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
}

await main()
