import { describe, expect, test } from 'bun:test';

import {
  isQuestionToolName,
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
