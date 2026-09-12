/** Minimal stub so the settings registry can bind input-history fields (Pi). */
type State = {
  scope: 'global' | 'project' | 'session';
  limit: number;
  setScope: (scope: 'global' | 'project' | 'session') => void;
  setLimit: (limit: number) => void;
};

let state: State = {
  scope: 'project',
  limit: 100,
  setScope(scope) { state = { ...state, scope }; },
  setLimit(limit) { state = { ...state, limit }; },
};

export const useInputHistoryStore = Object.assign(
  (selector?: (s: State) => unknown) => (selector ? selector(state) : state),
  {
    getState: () => state,
    setState: (partial: Partial<State>) => { state = { ...state, ...partial }; },
    subscribe: (_listener: () => void) => () => {},
  },
);
