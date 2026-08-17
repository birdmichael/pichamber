import { describe, expect, test } from 'bun:test';
import type { Agent } from '@opencode-ai/sdk/v2';

import {
  getComposerKnownAgentNames,
  getComposerMentionableAgents,
  parseAgentMentions,
  shouldRouteComposerAgentMentions,
} from './agentMentions';
import { buildOutgoingMessage } from '@/components/chat/composer/submit/buildOutgoingMessage';

const leftoverOpenCodeAgents = [
  { name: 'pi', mode: 'primary' },
  { name: 'build', mode: 'subagent' },
  { name: 'plan', mode: 'subagent' },
  { name: 'reviewer', mode: 'all' },
] as Agent[];

const openCodeAgents = leftoverOpenCodeAgents;

describe('shouldRouteComposerAgentMentions', () => {
  test('Pi does not route leftover OpenCode @agent mentions', () => {
    expect(shouldRouteComposerAgentMentions(true)).toBe(false);
  });

  test('OpenCode kernel still routes @agent mentions', () => {
    expect(shouldRouteComposerAgentMentions(false)).toBe(true);
  });
});

describe('getComposerMentionableAgents', () => {
  test('Pi autocomplete does not list leftover OpenCode agents', () => {
    expect(getComposerMentionableAgents(leftoverOpenCodeAgents, { isPiKernel: true })).toEqual([]);
    expect(getComposerMentionableAgents([{ name: 'pi', mode: 'primary' }], { isPiKernel: true })).toEqual([]);
  });

  test('OpenCode autocomplete still lists non-primary agents', () => {
    expect(getComposerMentionableAgents(openCodeAgents, { isPiKernel: false }).map((agent) => agent.name))
      .toEqual(['build', 'plan', 'reviewer']);
  });
});

describe('getComposerKnownAgentNames', () => {
  test('Pi does not highlight leftover OpenCode agent names', () => {
    expect(getComposerKnownAgentNames(leftoverOpenCodeAgents, { isPiKernel: true }).size).toBe(0);
  });

  test('OpenCode still highlights known agent names', () => {
    expect(getComposerKnownAgentNames(openCodeAgents, { isPiKernel: false }))
      .toEqual(new Set(['pi', 'build', 'plan', 'reviewer']));
  });
});

describe('parseAgentMentions', () => {
  test('Pi does not treat @agent:build or @agent:plan as an agent switch', () => {
    for (const text of ['@agent:build do it', '@agent:plan a plan', '@build ship it', '@plan think']) {
      expect(parseAgentMentions(text, leftoverOpenCodeAgents, { isPiKernel: true })).toEqual({
        sanitizedText: text,
        mention: null,
      });
    }
  });

  test('Pi send path keeps leftover @agent text as chat, not a routed mention', () => {
    const parseAgentMention = (text: string) => {
      const { sanitizedText, mention } = parseAgentMentions(text, leftoverOpenCodeAgents, { isPiKernel: true });
      return { text: sanitizedText, agentName: mention?.name };
    };

    const result = buildOutgoingMessage({
      queued: [],
      composerText: '@agent:build do it',
      composerAttachments: [],
      inlineComments: [],
      syntheticTexts: [],
      linkedIssueContext: null,
      linkedPr: null,
    }, {
      parseAgentMention,
      extractFileMentions: (text) => ({ text, attachments: [] }),
      sanitizeAttachments: (files) => [...(files ?? [])],
      collectSkillNames: () => [],
      appendComments: (text) => text,
      buildSkillInstruction: () => null,
    });

    expect(result.agentMentionName).toBeUndefined();
    expect(result.primaryText).toBe('@agent:build do it');
  });

  test('OpenCode kernel still routes a leftover @build mention', () => {
    const result = parseAgentMentions('@build ship it', openCodeAgents, { isPiKernel: false });
    expect(result.mention?.name).toBe('build');
    expect(result.sanitizedText).toBe('@build ship it');
  });

  test('OpenCode kernel still routes @plan when that agent exists', () => {
    expect(parseAgentMentions('@plan think', openCodeAgents, { isPiKernel: false }).mention?.name)
      .toBe('plan');
  });

  test('OpenCode send path still reports the first routed mention', () => {
    const parseAgentMention = (text: string) => {
      const { sanitizedText, mention } = parseAgentMentions(text, openCodeAgents, { isPiKernel: false });
      return { text: sanitizedText, agentName: mention?.name };
    };

    const result = buildOutgoingMessage({
      queued: [],
      composerText: '@build do it',
      composerAttachments: [],
      inlineComments: [],
      syntheticTexts: [],
      linkedIssueContext: null,
      linkedPr: null,
    }, {
      parseAgentMention,
      extractFileMentions: (text) => ({ text, attachments: [] }),
      sanitizeAttachments: (files) => [...(files ?? [])],
      collectSkillNames: () => [],
      appendComments: (text) => text,
      buildSkillInstruction: () => null,
    });

    expect(result.agentMentionName).toBe('build');
    expect(result.primaryText).toBe('@build do it');
  });

  test('primary-only agents never route, matching the OpenCode mention list', () => {
    const primaryOnly = [{ name: 'build', mode: 'primary' }] as Agent[];
    expect(parseAgentMentions('@build do it', primaryOnly, { isPiKernel: false }).mention).toBeNull();
  });
});
