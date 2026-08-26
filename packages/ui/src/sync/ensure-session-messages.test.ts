import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('useEnsureSessionMessages', () => {
  test('fetches child sessions that are not yet in the directory list', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'sync-context.tsx'),
      'utf8',
    )
    const fn = source.slice(source.indexOf('export function useEnsureSessionMessages'))
    expect(fn).toContain('materializeSessionFromServer')
    expect(fn).not.toMatch(/if \(!state\.session\.some\(\(s\) => s\.id === sessionID\)\) return/)
  })
})
