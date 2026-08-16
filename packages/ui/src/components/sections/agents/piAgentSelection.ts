import React from 'react';
import { filterVisibleAgents, useAgentsStore } from '@/stores/useAgentsStore';

export const PI_NATIVE_AGENT_NAME = 'pi';

export function resolvePiDefaultAgentSelection(agents: Array<{ name: string }>): string | null {
  return agents.some((agent) => agent.name === PI_NATIVE_AGENT_NAME)
    ? PI_NATIVE_AGENT_NAME
    : null;
}

export function useSelectPiAgentWhenUnset(enabled: boolean): void {
  const selectedAgentName = useAgentsStore((state) => state.selectedAgentName);
  const agents = useAgentsStore((state) => state.agents);
  const agentDraft = useAgentsStore((state) => state.agentDraft);
  const setSelectedAgent = useAgentsStore((state) => state.setSelectedAgent);
  const loadAgents = useAgentsStore((state) => state.loadAgents);

  React.useEffect(() => {
    if (!enabled) {
      return;
    }
    void loadAgents();
  }, [enabled, loadAgents]);

  React.useEffect(() => {
    if (!enabled || selectedAgentName || agentDraft) {
      return;
    }
    const name = resolvePiDefaultAgentSelection(filterVisibleAgents(agents));
    if (name) {
      setSelectedAgent(name);
    }
  }, [agentDraft, agents, enabled, selectedAgentName, setSelectedAgent]);
}
