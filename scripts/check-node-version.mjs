/* global console, process */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expectedVersion = readFileSync(resolve(rootDirectory, '.nvmrc'), 'utf8')
  .trim()
  .replace(/^v/, '')
const actualVersion = process.version.replace(/^v/, '')
const checkMajorOnly =
  process.argv.includes('--major') || process.env.NODE_VERSION_CHECK === 'major'

if (!expectedVersion) {
  console.error('Expected .nvmrc to contain a Node version.')
  process.exit(1)
}

if (checkMajorOnly) {
  const expectedMajor = expectedVersion.split('.')[0]
  const actualMajor = actualVersion.split('.')[0]

  if (actualMajor !== expectedMajor) {
    console.error(
      `Expected Node major version ${expectedMajor} from .nvmrc, but running ${actualVersion}.`,
    )
    process.exit(1)
  }
} else if (actualVersion !== expectedVersion) {
  console.error(
    `Expected Node ${expectedVersion} from .nvmrc, but running ${actualVersion}. Run \`nvm use\` before installing dependencies.`,
  )
  process.exit(1)
}
