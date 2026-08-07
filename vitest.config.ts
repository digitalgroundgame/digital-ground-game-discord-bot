import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      DISCORD_BOT_CONTROL_API_SECRET: 'test-control-api-secret',
    },
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
  },
})
