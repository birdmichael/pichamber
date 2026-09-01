import { describe, expect, test } from 'bun:test'
import type { Part } from '@opencode-ai/sdk/v2'
import { CONTEXT_METADATA_KEY } from '@/lib/messages/contextParts'
import { getFullText, getMessagePreview } from './messagePreview'

const textPart = (text: string): Part => ({ type: 'text', text } as Part)
const contextPart = (): Part => ({
  type: 'text',
  text: 'Comment on `src/app.ts` lines 3-5:\n```ts\nconst x = 1;\n```\n\nfix this',
  synthetic: true,
  metadata: {
    [CONTEXT_METADATA_KEY]: {
      kind: 'code-comment',
      source: 'file',
      fileLabel: 'src/app.ts',
      startLine: 3,
      endLine: 5,
      language: 'ts',
      code: 'const x = 1;',
      text: 'fix this',
    },
  },
} as unknown as Part)

describe('messagePreview', () => {
  test('joins text parts for full text', () => {
    expect(getFullText([textPart('hello'), textPart('world')])).toBe('hello\nworld')
  })

  test('collapses newlines and truncates previews', () => {
    expect(getMessagePreview([textPart('line one\nline two')], 80)).toBe('line one line two')
    expect(getMessagePreview([textPart('abcdefghijklmnopqrstuvwxyz')], 10)).toBe('abcdefghij…')
  })

  test('returns empty string when there is no text', () => {
    expect(getMessagePreview([])).toBe('')
    expect(getFullText([{ type: 'file' } as Part])).toBe('')
  })

  test('summarizes context-only turns from structured payload without i18n', () => {
    expect(getMessagePreview([contextPart()])).toBe('app.ts:3-5: fix this')
  })
})
