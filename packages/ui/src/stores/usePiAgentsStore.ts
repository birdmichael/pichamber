import { create } from 'zustand';
import { runtimeFetch } from '@/lib/runtime-fetch';

export type PiAgentScope = 'user' | 'project' | 'builtin';

export type PiRosterAgent = {
  id: string;
  name: string;
  description?: string;
  model?: string;
  thinking?: string;
  tools?: unknown;
  scope: PiAgentScope;
  readOnly?: boolean;
  frontmatter?: Record<string, unknown>;
  body?: string;
};

type PiAgentsState = {
  agents: PiRosterAgent[];
  selectedName: string | null;
  isCreating: boolean;
  isLoading: boolean;
  loadError: string | null;
  load: (directory?: string | null) => Promise<void>;
  setSelected: (name: string | null) => void;
  startCreating: () => void;
  cancelCreating: () => void;
  save: (input: { name: string; scope: 'user' | 'project'; frontmatter: Record<string, unknown>; body: string }, directory?: string | null) => Promise<PiRosterAgent>;
  remove: (agent: PiRosterAgent, directory?: string | null) => Promise<void>;
};

const directoryQuery = (directory?: string | null): string => (
  directory?.trim() ? `?directory=${encodeURIComponent(directory.trim())}` : ''
);

const errorMessage = (payload: unknown, fallback: string): string => (
  payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
    ? (payload as { error: string }).error
    : fallback
);

export const usePiAgentsStore = create<PiAgentsState>((set, get) => ({
  agents: [], selectedName: null, isCreating: false, isLoading: false, loadError: null,
  load: async (directory) => {
    set({ isLoading: true, loadError: null });
    try {
      const response = await runtimeFetch(`/api/pi/subagents${directoryQuery(directory)}`, { headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(payload, 'Unable to load Pi agents'));
      set({ agents: Array.isArray(payload?.agents) ? payload.agents as PiRosterAgent[] : [], isLoading: false });
    } catch (error) {
      set({ isLoading: false, loadError: error instanceof Error ? error.message : 'Unable to load Pi agents' });
    }
  },
  setSelected: (name) => set({ selectedName: name, isCreating: false }),
  startCreating: () => set({ selectedName: null, isCreating: true }),
  cancelCreating: () => set({ isCreating: false }),
  save: async (input, directory) => {
    const response = await runtimeFetch(`/api/pi/subagents/${encodeURIComponent(input.name)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...input, body: input.body }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorMessage(payload, 'Unable to save Pi agent'));
    const saved = payload as PiRosterAgent;
    set((state) => ({ agents: [...state.agents.filter((agent) => agent.name !== saved.name), saved].sort((a, b) => a.name.localeCompare(b.name)), selectedName: saved.name, isCreating: false }));
    void get().load(directory);
    return saved;
  },
  remove: async (agent, directory) => {
    const response = await runtimeFetch(`/api/pi/subagents/${encodeURIComponent(agent.name)}?scope=${agent.scope}`, { method: 'DELETE', headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorMessage(payload, 'Unable to delete Pi agent'));
    set((state) => ({ agents: state.agents.filter((item) => item.name !== agent.name), selectedName: state.selectedName === agent.name ? null : state.selectedName }));
    void get().load(directory);
  },
}));
