/** Minimal stub so the settings registry can bind input-history fields (Pi). */
import {
  DEFAULT_INPUT_HISTORY_LIMIT,
  DEFAULT_INPUT_HISTORY_SCOPE,
  type InputHistoryScope,
} from '@/lib/inputHistoryScope';

type State = {
  scope: InputHistoryScope;
  limit: number;
  entryLimit: number;
  setScope: (scope: InputHistoryScope) => void;
  setLimit: (limit: number) => void;
  applyScope: (scope: InputHistoryScope) => void;
  applyEntryLimit: (limit: number) => void;
};

let state: State = {
  scope: DEFAULT_INPUT_HISTORY_SCOPE,
  limit: DEFAULT_INPUT_HISTORY_LIMIT,
  entryLimit: DEFAULT_INPUT_HISTORY_LIMIT,
  setScope(scope) {
    state = { ...state, scope };
  },
  setLimit(limit) {
    state = { ...state, limit, entryLimit: limit };
  },
  applyScope(scope) {
    state = { ...state, scope };
  },
  applyEntryLimit(limit) {
    state = { ...state, limit, entryLimit: limit };
  },
};

export const useInputHistoryStore = Object.assign(
  (selector?: (s: State) => unknown) => (selector ? selector(state) : state),
  {
    getState: () => state,
    setState: (partial: Partial<State>) => { state = { ...state, ...partial }; },
    subscribe: (_listener: () => void) => { void _listener; return () => {}; },
  },
);
