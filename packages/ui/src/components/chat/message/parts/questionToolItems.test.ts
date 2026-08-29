import { describe, expect, test } from 'bun:test';

import {
  boundQuestionPromptIds,
  messagesWithLiveQuestionParts,
  isActiveQuestionToolStatus,
  isQuestionToolName,
  matchPendingQuestionPrompt,
  parseQuestionToolOutput,
  questionItemsFromToolPart,
  questionToolDescription,
} from './questionToolItems';

describe('isQuestionToolName', () => {
  test('matches question and plan_mode_question only', () => {
    expect(isQuestionToolName('question')).toBe(true);
    expect(isQuestionToolName('plan_mode_question')).toBe(true);
    expect(isQuestionToolName('bash')).toBe(false);
    expect(isQuestionToolName('')).toBe(false);
  });
});

describe('parseQuestionToolOutput', () => {
  test('parses OpenCode answered-questions output', () => {
    expect(parseQuestionToolOutput(
      'User has answered your questions: "Which path?"="SKILL.md". You can now continue.',
    )).toEqual([{ question: 'Which path?', answer: 'SKILL.md' }]);
  });

  test('parses Desktop Pi question tool results', () => {
    expect(parseQuestionToolOutput('User selected: 1. One file')).toEqual([
      { question: '', answer: 'One file' },
    ]);
    expect(parseQuestionToolOutput('User wrote: only the host module')).toEqual([
      { question: '', answer: 'only the host module' },
    ]);
    expect(parseQuestionToolOutput('User cancelled the selection')).toEqual([]);
  });
});

describe('questionItemsFromToolPart', () => {
  test('keeps OpenCode questions[] plus parsed answers', () => {
    expect(questionItemsFromToolPart({
      tool: 'question',
      state: {
        status: 'completed',
        input: {
          questions: [{ question: 'Which path?', options: [{ label: 'SKILL.md' }] }],
        },
        output: 'User has answered your questions: "Which path?"="SKILL.md". You can now continue.',
        metadata: { answers: [['SKILL.md']] },
      },
    })).toEqual([{
      question: 'Which path?',
      answer: 'SKILL.md',
      cancelled: false,
      options: [{ label: 'SKILL.md' }],
    }]);
  });

  test('materializes a Desktop Pi question from input, details, and User selected output', () => {
    expect(questionItemsFromToolPart({
      tool: 'question',
      state: {
        status: 'completed',
        input: { question: 'Which path?', options: ['SKILL.md', 'README.md'] },
        output: 'User selected: 1. SKILL.md',
        metadata: {
          question: 'Which path?',
          options: ['SKILL.md', 'README.md'],
          answer: 'SKILL.md',
          wasCustom: false,
        },
      },
    })).toEqual([{
      question: 'Which path?',
      answer: 'SKILL.md',
      cancelled: false,
      options: [{ label: 'SKILL.md' }, { label: 'README.md' }],
    }]);
  });

  test('keeps a cancelled Pi question on the asking turn', () => {
    expect(questionItemsFromToolPart({
      tool: 'question',
      state: {
        status: 'completed',
        input: { question: 'Continue?', options: ['Yes', 'No'] },
        output: 'User cancelled the selection',
        metadata: { question: 'Continue?', options: ['Yes', 'No'], answer: null },
      },
    })).toEqual([{
      question: 'Continue?',
      answer: '',
      cancelled: true,
      options: [{ label: 'Yes' }, { label: 'No' }],
    }]);
  });

  test('materializes an open-ended pending Pi question without options', () => {
    expect(questionItemsFromToolPart({
      tool: 'question',
      state: {
        status: 'running',
        input: { question: 'What should we work on next?' },
      },
    })).toEqual([{
      question: 'What should we work on next?',
      answer: '',
      cancelled: false,
      options: [],
    }]);
  });

  test('shows the pending Pi question text before an answer arrives', () => {
    expect(questionItemsFromToolPart({
      tool: 'plan_mode_question',
      state: {
        status: 'running',
        input: { question: 'How wide?', options: [{ label: 'One file', description: 'keep it local' }] },
      },
    })).toEqual([{
      question: 'How wide?',
      answer: '',
      cancelled: false,
      options: [{ label: 'One file', description: 'keep it local' }],
    }]);
  });
});

describe('matchPendingQuestionPrompt', () => {
  test('binds a pending select/editor prompt onto the asking question turn', () => {
    const part = {
      type: 'tool',
      tool: 'question',
      state: {
        status: 'running',
        input: { question: 'What should we work on next?', options: [] },
      },
    };
    expect(matchPendingQuestionPrompt([
      { id: 'pui_plan', title: 'Plan mode', kind: 'select', status: 'pending' },
      { id: 'pui_q', title: 'What should we work on next?', kind: 'editor', status: 'pending' },
    ], part)?.id).toBe('pui_q');
  });

  test('pairs the only pending prompt when titles are missing', () => {
    expect(matchPendingQuestionPrompt([
      { id: 'pui_only', title: '', kind: 'select', status: 'pending' },
    ], {
      tool: 'question',
      state: { status: 'running', input: { question: 'Pick one', options: ['A'] } },
    })?.id).toBe('pui_only');
  });

  test('does not guess when several pending prompts do not match the turn', () => {
    expect(matchPendingQuestionPrompt([
      { id: 'pui_a', title: 'A', kind: 'select', status: 'pending' },
      { id: 'pui_b', title: 'B', kind: 'select', status: 'pending' },
    ], {
      tool: 'question',
      state: { status: 'running', input: { question: 'C', options: ['Yes'] } },
    })).toBeNull();
  });

  test('keeps bound prompt ids on the asking turn for session revisit', () => {
    const prompts = [
      { id: 'pui_q', title: 'What should we work on next?', kind: 'editor', status: 'pending' },
      { id: 'pui_plan', title: 'Start Plan mode', kind: 'select', status: 'pending' },
    ];
    expect([...boundQuestionPromptIds(prompts, [{
      parts: [{
        type: 'tool',
        tool: 'question',
        state: {
          status: 'pending',
          input: { question: 'What should we work on next?' },
        },
      }],
    }])]).toEqual(['pui_q']);
  });

  test('binds using live parts when the rendered message snapshot is still empty', () => {
    const prompts = [
      { id: 'pui_q', title: 'Should we continue?', kind: 'select', status: 'pending' },
    ];
    const rendered = [{
      info: { id: 'msg_1' },
      parts: [],
    }];
    const liveParts = {
      msg_1: [{
        type: 'tool',
        tool: 'question',
        state: {
          status: 'running',
          input: { question: 'Should we continue?', options: ['Yes', 'No'] },
        },
      }],
    };
    expect([...boundQuestionPromptIds(prompts, rendered)]).toEqual([]);
    expect([...boundQuestionPromptIds(prompts, messagesWithLiveQuestionParts(rendered, liveParts))])
      .toEqual(['pui_q']);
  });

  test('treats pending and running as active question-tool statuses', () => {
    expect(isActiveQuestionToolStatus('pending')).toBe(true);
    expect(isActiveQuestionToolStatus('running')).toBe(true);
    expect(isActiveQuestionToolStatus('completed')).toBe(false);
  });
});

describe('questionToolDescription', () => {
  test('prefers the answer, then the question, then the asked-count', () => {
    expect(questionToolDescription([{
      question: 'Which path?',
      answer: 'SKILL.md',
      cancelled: false,
      options: [],
    }])).toBe('SKILL.md');
    expect(questionToolDescription([{
      question: 'Which path?',
      answer: '',
      cancelled: false,
      options: [],
    }])).toBe('Which path?');
    expect(questionToolDescription([
      { question: 'A', answer: '', cancelled: false, options: [] },
      { question: 'B', answer: '', cancelled: false, options: [] },
    ])).toBe('Asked 2 questions');
  });
});
