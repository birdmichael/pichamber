import { describe, expect, test } from 'bun:test'

import { resolveAssistantFooterModel } from './assistantFooterModel'

const grok = { providerId: 'xai', modelId: 'grok-4.6' }
const deepseek = { providerId: 'deepseek', modelId: 'deepseek-v4-flash' }

describe('resolveAssistantFooterModel', () => {
  test('uses the user-turn model when assistant info is empty', () => {
    expect(resolveAssistantFooterModel({
      assistantInfo: { role: 'assistant' },
      userTurnInfo: {
        role: 'user',
        model: { providerID: grok.providerId, modelID: grok.modelId },
      },
      sessionSelection: grok,
      agentSelection: deepseek,
    })).toEqual(grok)
  })

  test('does not keep a stale assistant catalog model that disagrees with the user-turn', () => {
    expect(resolveAssistantFooterModel({
      assistantInfo: {
        role: 'assistant',
        providerID: deepseek.providerId,
        modelID: deepseek.modelId,
      },
      userTurnInfo: {
        role: 'user',
        providerID: grok.providerId,
        modelID: grok.modelId,
        model: `${grok.providerId}/${grok.modelId}`,
      },
      sessionSelection: grok,
      agentSelection: deepseek,
    })).toEqual(grok)
  })

  test('reads nested and string user-turn model fields after a server echo', () => {
    expect(resolveAssistantFooterModel({
      assistantInfo: { role: 'assistant', providerID: 'pi', modelID: 'pi' },
      userTurnInfo: {
        role: 'user',
        model: { providerID: grok.providerId, modelID: grok.modelId },
      },
      agentSelection: deepseek,
    })).toEqual(grok)

    expect(resolveAssistantFooterModel({
      assistantInfo: { role: 'assistant' },
      userTurnInfo: {
        role: 'user',
        model: `${grok.providerId}/${grok.modelId}`,
      },
      agentSelection: deepseek,
    })).toEqual(grok)
  })

  test('after Grok → DeepSeek → Grok, a leftover agent pin does not leak onto the Grok turn', () => {
    expect(resolveAssistantFooterModel({
      assistantInfo: { role: 'assistant' },
      userTurnInfo: { role: 'user' },
      sessionSelection: grok,
      agentSelection: deepseek,
    })).toEqual(grok)
  })

  test('keeps the assistant model that ran when the composer changed after send', () => {
    expect(resolveAssistantFooterModel({
      assistantInfo: {
        role: 'assistant',
        providerID: grok.providerId,
        modelID: grok.modelId,
      },
      userTurnInfo: { role: 'assistant', providerID: deepseek.providerId, modelID: deepseek.modelId },
      sessionSelection: deepseek,
      agentSelection: deepseek,
    })).toEqual(grok)
  })

  test('does not invent an unrelated catalog model when every source is empty', () => {
    expect(resolveAssistantFooterModel({
      assistantInfo: { role: 'assistant', providerID: 'pi', modelID: 'pi' },
      userTurnInfo: { role: 'user' },
      sessionSelection: { providerId: '', modelId: '' },
      agentSelection: null,
    })).toBeNull()
  })
})
