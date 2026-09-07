import React from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { useSettingsDirectory } from '@/hooks/useSettingsDirectory';
import { useFeaturePluginSlotActive } from '@/stores/useFeaturePluginSlotsStore';
import { usePiAgentsStore, type PiRosterAgent } from '@/stores/usePiAgentsStore';
import { SettingsProjectSelector } from '@/components/sections/shared/SettingsProjectSelector';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { cn } from '@/lib/utils';
import { SETTINGS_PANEL_TITLE_CLASS } from '@/components/sections/shared/SettingsSection';

type Props = { onItemSelect?: () => void };

const AgentRow: React.FC<{ agent: PiRosterAgent; selected: boolean; onSelect: () => void }> = ({ agent, selected, onSelect }) => (
  <button type="button" onClick={onSelect} className={cn('flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-muted/60', selected && 'bg-muted')}>
    <Icon name={agent.readOnly ? 'lock' : 'ai-agent'} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    <span className="min-w-0">
      <span className="block truncate typography-ui-label font-medium">{agent.name}</span>
      <span className="block truncate typography-meta text-muted-foreground">{agent.description || '—'}</span>
    </span>
  </button>
);

export const PiAgentsSidebar: React.FC<Props> = ({ onItemSelect }) => {
  const { t } = useI18n();
  const directory = useSettingsDirectory();
  const active = useFeaturePluginSlotActive('subagents', true);
  const { agents, selectedName, isCreating, isLoading, load, setSelected, startCreating } = usePiAgentsStore();
  React.useEffect(() => { if (active) void load(directory); }, [active, directory, load]);
  const builtin = agents.filter((agent) => agent.scope === 'builtin');
  const user = agents.filter((agent) => agent.scope === 'user');
  const project = agents.filter((agent) => agent.scope === 'project');

  return <div className="flex h-full flex-col bg-background">
    <div className="border-b px-3 pb-3 pt-4">
      <h2 className={`${SETTINGS_PANEL_TITLE_CLASS} mb-3`}>{t('settings.piAgents.title')}</h2>
      <SettingsProjectSelector className="mb-3" />
      <div className="flex items-center justify-between">
        <span className="typography-meta text-muted-foreground">{t('settings.piAgents.count', { count: user.length + project.length })}</span>
        <Button size="sm" variant="ghost" className="h-7 w-7 px-0 text-muted-foreground" onClick={() => { startCreating(); onItemSelect?.(); }} disabled={!active} aria-label={t('settings.piAgents.create')}><Icon name="add" className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
    {!active ? <div className="p-4 typography-meta text-muted-foreground">{t('settings.piAgents.pluginRequired')}</div> : <ScrollableOverlay outerClassName="min-h-0 flex-1" className="space-y-1 px-3 py-2">
      <button type="button" onClick={() => { setSelected(null); onItemSelect?.(); }} className={cn('flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-muted/60', !selectedName && !isCreating && 'bg-muted')}>
        <Icon name="ai-agent" className="mt-0.5 h-3.5 w-3.5 text-primary" /><span><span className="block typography-ui-label font-medium">{t('settings.piAgents.piRow')}</span><span className="block typography-meta text-muted-foreground">{t('settings.piAgents.piRowDescription')}</span></span>
      </button>
      {builtin.length > 0 && <><div className="px-2 pb-1 pt-3 typography-meta font-semibold uppercase tracking-wide text-muted-foreground">{t('settings.piAgents.builtin')}</div>{builtin.map((agent) => <AgentRow key={agent.name} agent={agent} selected={selectedName === agent.name} onSelect={() => { setSelected(agent.name); onItemSelect?.(); }} />)}</>}
      {user.length > 0 && <><div className="px-2 pb-1 pt-3 typography-meta font-semibold uppercase tracking-wide text-muted-foreground">{t('settings.piAgents.user')}</div>{user.map((agent) => <AgentRow key={agent.name} agent={agent} selected={selectedName === agent.name} onSelect={() => { setSelected(agent.name); onItemSelect?.(); }} />)}</>}
      {project.length > 0 && <><div className="px-2 pb-1 pt-3 typography-meta font-semibold uppercase tracking-wide text-muted-foreground">{t('settings.piAgents.project')}</div>{project.map((agent) => <AgentRow key={agent.name} agent={agent} selected={selectedName === agent.name} onSelect={() => { setSelected(agent.name); onItemSelect?.(); }} />)}</>}
      {isLoading && <div className="px-2 py-3 typography-meta text-muted-foreground">{t('common.loading')}</div>}
    </ScrollableOverlay>}
  </div>;
};
