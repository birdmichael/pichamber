import { describe, expect, it } from 'vitest';

import {
  TODO_TOOL_NAME,
  isTaskDetails,
  isTodoSlotActive,
  mapTasksToOpenCodeTodos,
  replayTodosFromEntries,
} from './session-todo.js';

const todoResult = (details, extras = {}) => ({
  type: 'message',
  message: {
    role: 'toolResult',
    toolName: TODO_TOOL_NAME,
    details,
    ...extras,
  },
});

const details = (tasks, nextId = tasks.length + 1, extra = {}) => ({
  action: 'list',
  params: {},
  tasks,
  nextId,
  ...extra,
});

describe('session-todo', () => {
  it('keeps the replay tool name as todo', () => {
    expect(TODO_TOOL_NAME).toBe('todo');
  });

  it('accepts TaskDetails and rejects leftover or malformed snapshots', () => {
    expect(isTaskDetails(details([{ id: 1, subject: 'Ship', status: 'pending' }], 2))).toBe(true);
    expect(isTaskDetails({ tasks: [], nextId: 1, error: 'unknown id' })).toBe(true);
    expect(isTaskDetails({ tasks: [] })).toBe(false);
    expect(isTaskDetails({ nextId: 1 })).toBe(false);
    expect(isTaskDetails(null)).toBe(false);
    expect(isTaskDetails('todo')).toBe(false);
  });

  it('maps rpiv tasks onto OpenCode todos without description or blockedBy', () => {
    expect(mapTasksToOpenCodeTodos([
      {
        id: 1,
        subject: 'Write tests',
        description: 'do not draw this',
        status: 'in_progress',
        blockedBy: [2],
        owner: 'agent',
      },
      { id: 2, subject: 'Review', status: 'completed' },
      { id: 3, subject: 'Dropped', status: 'deleted' },
    ])).toEqual([
      { id: '1', content: 'Write tests', status: 'in_progress', priority: 'medium' },
      { id: '2', content: 'Review', status: 'completed', priority: 'medium' },
      { id: '3', content: 'Dropped', status: 'cancelled', priority: 'medium' },
    ]);
  });

  it('skips invalid tasks instead of inventing OpenCode rows', () => {
    expect(mapTasksToOpenCodeTodos([
      null,
      { subject: 'no id', status: 'pending' },
      { id: 1, status: 'pending' },
      { id: 4, subject: 'Keep', status: 'pending' },
    ])).toEqual([
      { id: '4', content: 'Keep', status: 'pending', priority: 'medium' },
    ]);
  });

  it('replays the last matching todo toolResult (last-write-wins)', () => {
    const replayed = replayTodosFromEntries([
      todoResult(details([{ id: 1, subject: 'Old', status: 'pending' }], 2)),
      {
        type: 'message',
        message: {
          role: 'toolResult',
          toolName: 'todowrite',
          details: details([{ id: 99, subject: 'leftover OpenCode', status: 'pending' }], 100),
        },
      },
      todoResult(details([
        { id: 1, subject: 'Old', status: 'completed' },
        { id: 2, subject: 'New', status: 'pending' },
      ], 3, { action: 'update' })),
    ]);
    expect(replayed.nextId).toBe(3);
    expect(mapTasksToOpenCodeTodos(replayed.tasks)).toEqual([
      { id: '1', content: 'Old', status: 'completed', priority: 'medium' },
      { id: '2', content: 'New', status: 'pending', priority: 'medium' },
    ]);
  });

  it('counts list/get and in-band error snapshots as writes', () => {
    const replayed = replayTodosFromEntries([
      todoResult(details([{ id: 1, subject: 'Ship', status: 'pending' }], 2, { action: 'create' })),
      todoResult(details([{ id: 1, subject: 'Ship', status: 'pending' }], 2, {
        action: 'update',
        error: 'unknown id',
      })),
    ]);
    expect(replayed.tasks).toEqual([{ id: 1, subject: 'Ship', status: 'pending' }]);
  });

  it('returns an empty snapshot when the branch has no todo details', () => {
    expect(replayTodosFromEntries([])).toEqual({ tasks: [], nextId: 1 });
    expect(replayTodosFromEntries(null)).toEqual({ tasks: [], nextId: 1 });
    expect(replayTodosFromEntries([
      { type: 'custom', customType: 'plan-mode-state', data: {} },
      { type: 'message', message: { role: 'user', content: 'hi' } },
    ])).toEqual({ tasks: [], nextId: 1 });
  });

  it('does not mix parent and child entry lists', () => {
    const parent = replayTodosFromEntries([
      todoResult(details([{ id: 1, subject: 'Parent', status: 'pending' }], 2)),
    ]);
    const child = replayTodosFromEntries([
      todoResult(details([{ id: 1, subject: 'Child', status: 'in_progress' }], 2)),
    ]);
    expect(mapTasksToOpenCodeTodos(parent.tasks)[0].content).toBe('Parent');
    expect(mapTasksToOpenCodeTodos(child.tasks)[0].content).toBe('Child');
  });

  it('treats the Feature Plugin slot as installed+enabled only', () => {
    expect(isTodoSlotActive({ slots: { todo: { installed: true, enabled: true } } })).toBe(true);
    expect(isTodoSlotActive({ slots: { todo: { installed: true, enabled: false } } })).toBe(false);
    expect(isTodoSlotActive({ slots: { todo: { installed: false, enabled: true } } })).toBe(false);
    expect(isTodoSlotActive({})).toBe(false);
  });
});
