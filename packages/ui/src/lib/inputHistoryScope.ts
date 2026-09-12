export type InputHistoryScope = 'global' | 'project' | 'session';
export const DEFAULT_INPUT_HISTORY_SCOPE: InputHistoryScope = 'project';
export const DEFAULT_INPUT_HISTORY_LIMIT = 100;
export const isInputHistoryScope = (value: unknown): value is InputHistoryScope =>
  value === 'global' || value === 'project' || value === 'session';
export const isInputHistoryLimit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
