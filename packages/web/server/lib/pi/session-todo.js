// Live rpiv-todo list from the session branch's last todo toolResult details.
// Mirrors session-plan.js latestCompletionPlan. Do not scrape TUI widgets,
// read ~/.config/rpiv-todo/config.json, or import the extension process Map.

export const TODO_TOOL_NAME = 'todo';

const OPENCODE_TODO_STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isTaskDetails = (value) => (
  isRecord(value)
  && Array.isArray(value.tasks)
  && typeof value.nextId === 'number'
);

const mapTaskStatus = (status) => {
  if (status === 'deleted') return 'cancelled';
  if (typeof status === 'string' && OPENCODE_TODO_STATUSES.has(status)) return status;
  return 'pending';
};

export const mapTasksToOpenCodeTodos = (tasks) => {
  if (!Array.isArray(tasks)) return [];
  const todos = [];
  for (const task of tasks) {
    if (!isRecord(task)) continue;
    if (typeof task.id !== 'number' && typeof task.id !== 'string') continue;
    if (typeof task.subject !== 'string') continue;
    todos.push({
      id: String(task.id),
      content: task.subject,
      status: mapTaskStatus(task.status),
      priority: 'medium',
    });
  }
  return todos;
};

const toolResultFromEntry = (entry) => {
  if (!isRecord(entry)) return null;
  if (entry.type && entry.type !== 'message') return null;
  const message = isRecord(entry.message) ? entry.message : entry;
  const role = message.role || entry.role;
  const toolName = message.toolName || entry.toolName;
  if (role !== 'toolResult' || toolName !== TODO_TOOL_NAME) return null;
  return message.details || entry.details;
};

export const replayTodosFromEntries = (entries) => {
  if (!Array.isArray(entries)) {
    return { tasks: [], nextId: 1 };
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const details = toolResultFromEntry(entries[index]);
    if (!isTaskDetails(details)) continue;
    return {
      tasks: details.tasks,
      nextId: details.nextId,
    };
  }

  return { tasks: [], nextId: 1 };
};

export const isTodoSlotActive = (payload) => {
  const slot = payload?.slots?.todo;
  return Boolean(slot?.installed && slot?.enabled);
};
