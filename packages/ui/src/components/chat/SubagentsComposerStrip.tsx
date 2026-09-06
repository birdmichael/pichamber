import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { toast } from '@/components/ui';
import { getProviderModelRefDisplayName } from '@/lib/modelDisplay';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { buildSubagentRunArguments, getSubagentRoleNames, SUBAGENT_THINKING_LEVELS, type SubagentRole } from './subagentsComposerStrip';
import type { PiThinkingLevel } from './piThinking';

type Provider = { id?: string | null; models?: Array<{ id?: string | null }> | null };
export interface SubagentsComposerStripProps {
  agents: ReadonlyArray<{ name?: string | null; mode?: string | null; hidden?: boolean }>
  providers: ReadonlyArray<Provider>; currentProviderId?: string | null; currentModelId?: string | null; currentThinking?: PiThinkingLevel; sessionId?: string | null; directory?: string | null; taskDraft: string;
  onLaunch: (params: { arguments: string; providerId: string; modelId: string; task: string }) => Promise<void>; onTaskConsumed?: () => void;
}

const controlClassName = 'h-7 min-w-0 rounded-md border border-border/70 bg-background/60 px-2 text-xs text-foreground outline-none focus:border-primary/70';

export const SubagentsComposerStrip: React.FC<SubagentsComposerStripProps> = (props) => {
  const { t } = useI18n();
  const roles = React.useMemo(() => getSubagentRoleNames(props.agents), [props.agents]);
  const models = React.useMemo(() => {
    const entries: Array<{ providerId: string; modelId: string }> = [];
    for (const provider of props.providers) {
      const providerId = typeof provider.id === 'string' ? provider.id.trim() : '';
      for (const model of provider.models ?? []) {
        const modelId = typeof model.id === 'string' ? model.id.trim() : '';
        if (providerId && modelId) entries.push({ providerId, modelId });
      }
    }
    if (props.currentProviderId && props.currentModelId && !entries.some((item) => item.providerId === props.currentProviderId && item.modelId === props.currentModelId)) entries.unshift({ providerId: props.currentProviderId, modelId: props.currentModelId });
    return entries;
  }, [props.currentModelId, props.currentProviderId, props.providers]);
  const [role, setRole] = React.useState<SubagentRole>(roles[0] ?? 'worker');
  const [modelRef, setModelRef] = React.useState(props.currentProviderId && props.currentModelId ? props.currentProviderId + '/' + props.currentModelId : '');
  const [thinking, setThinking] = React.useState<PiThinkingLevel>(props.currentThinking ?? 'medium');
  const [launching, setLaunching] = React.useState(false);
  React.useEffect(() => { if (!roles.includes(role)) setRole(roles[0] ?? 'worker'); }, [role, roles]);
  React.useEffect(() => { if (!modelRef && props.currentProviderId && props.currentModelId) setModelRef(props.currentProviderId + '/' + props.currentModelId); }, [modelRef, props.currentModelId, props.currentProviderId]);
  const handleLaunch = async () => {
    const task = props.taskDraft.trim() || (typeof window !== 'undefined' && typeof window.prompt === 'function' ? (window.prompt(t('chat.subagentsComposer.taskPrompt')) ?? '').trim() : '');
    if (!task) return;
    const slash = modelRef.indexOf('/'); const providerId = slash > 0 ? modelRef.slice(0, slash) : ''; const modelId = slash > 0 ? modelRef.slice(slash + 1) : '';
    if (!props.sessionId || !providerId || !modelId) { toast.error(t('chat.subagentsComposer.missingSessionOrModel')); return; }
    setLaunching(true);
    try { await props.onLaunch({ arguments: buildSubagentRunArguments({ role, providerId, modelId, thinking, task }), providerId, modelId, task }); props.onTaskConsumed?.(); }
    catch (error) { toast.error(error instanceof Error ? error.message : t('chat.subagentsComposer.launchFailed')); } finally { setLaunching(false); }
  };
  if (!models.length) return null;
  return <div className="mb-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-border/70 bg-muted/20 px-2 py-1.5" data-testid="subagents-composer-strip" data-session-id={props.sessionId ?? undefined} data-directory={props.directory ?? undefined}>
    <div className="mr-1 flex items-center gap-1 text-xs font-medium text-muted-foreground"><Icon name="robot" className="h-3.5 w-3.5" /><span>{t('chat.subagentsComposer.title')}</span></div>
    <label className="sr-only" htmlFor="subagents-composer-role">{t('chat.subagentsComposer.role')}</label><select id="subagents-composer-role" className={cn(controlClassName, 'max-w-32')} value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((name) => <option key={name} value={name}>{name}</option>)}</select>
    <label className="sr-only" htmlFor="subagents-composer-model">{t('chat.subagentsComposer.model')}</label><select id="subagents-composer-model" className={cn(controlClassName, 'max-w-56')} value={modelRef} onChange={(event) => setModelRef(event.target.value)}>{models.map(({ providerId, modelId }) => { const value = providerId + '/' + modelId; return <option key={value} value={value}>{getProviderModelRefDisplayName(providerId, modelId)}</option>; })}</select>
    <label className="sr-only" htmlFor="subagents-composer-thinking">{t('chat.subagentsComposer.thinking')}</label><select id="subagents-composer-thinking" className={cn(controlClassName, 'max-w-24')} value={thinking} onChange={(event) => setThinking(event.target.value as PiThinkingLevel)}>{SUBAGENT_THINKING_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</select>
    <button type="button" className="ml-auto inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" disabled={launching || !props.sessionId || !modelRef} onClick={() => void handleLaunch()}><Icon name="play" className="h-3.5 w-3.5" />{launching ? t('chat.subagentsComposer.launching') : t('chat.subagentsComposer.launch')}</button>
  </div>;
};
