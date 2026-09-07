import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { toast } from '@/components/ui';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { getProviderModelDisplayName } from '@/lib/modelDisplay';
import type { PiThinkingLevel } from './piThinking';
import { canLaunchSubagent, parseSubagentModelRef } from './subagentLaunch';

type Provider = { id?: string | null; name?: string | null; models?: Array<{ id?: string | null; name?: string | null }> | null };
type RosterAgent = { id: string; name: string; description?: string; model?: string; thinking?: string; tools?: unknown; scope: 'user' | 'project' | 'builtin'; readOnly?: boolean; frontmatter?: Record<string, unknown>; body?: string };
type LaunchArgs = { role: string; providerId: string; modelId: string; thinking: PiThinkingLevel; task: string };
type Props = { providers: ReadonlyArray<Provider>; currentThinking?: string; sessionId?: string | null; directory?: string | null; onLaunch: (args: LaunchArgs) => Promise<void>; onClose: () => void };
const LEVELS: PiThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const control = 'h-7 w-full rounded border border-border/70 bg-background px-2 text-xs outline-none focus:border-primary';
const modelsFor = (providers: ReadonlyArray<Provider>) => providers.flatMap((provider) => (provider.models || []).flatMap((model) => provider.id && model.id ? [{ providerId: provider.id, modelId: model.id, providerName: provider.name || provider.id, modelName: model.name || getProviderModelDisplayName({ models: provider.models ?? undefined }, model.id) }] : []));

export const SubagentRosterMenu: React.FC<Props> = (props) => {
  const { t } = useI18n();
  const [agents, setAgents] = React.useState<RosterAgent[]>([]);
  const [selected, setSelected] = React.useState<RosterAgent | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [name, setName] = React.useState(''); const [description, setDescription] = React.useState('');
  const [model, setModel] = React.useState(''); const [thinking, setThinking] = React.useState<string>(props.currentThinking || 'medium');
  const [tools, setTools] = React.useState(''); const [body, setBody] = React.useState(''); const [scope, setScope] = React.useState<'user' | 'project'>('user');
  const [task, setTask] = React.useState(''); const [saving, setSaving] = React.useState(false); const [running, setRunning] = React.useState(false);
  const [modelConfirmed, setModelConfirmed] = React.useState(false);
  const models = React.useMemo(() => modelsFor(props.providers), [props.providers]);
  const load = React.useCallback(async () => {
    if (!props.directory) return;
    const response = await runtimeFetch('/api/pi/subagents?directory=' + encodeURIComponent(props.directory));
    if (!response.ok) throw new Error('Unable to load subagents');
    const payload = await response.json(); const next = Array.isArray(payload?.agents) ? payload.agents as RosterAgent[] : [];
    setAgents(next);
  }, [props.directory]);
  React.useEffect(() => { void load().catch((error) => toast.error(error instanceof Error ? error.message : 'Unable to load subagents')); }, [load]);
  const selectAgent = (agent: RosterAgent | null) => {
    setSelected(agent); setEditorOpen(Boolean(agent)); setModelConfirmed(false); if (!agent) { setName(''); setDescription(''); setModel(''); setThinking(props.currentThinking || 'medium'); setTools(''); setBody(''); setScope('user'); return; }
    setName(agent.name); setDescription(agent.description || ''); setModel(agent.model || ''); setThinking(agent.thinking || props.currentThinking || 'medium'); setTools(Array.isArray(agent.tools) ? agent.tools.join(', ') : typeof agent.tools === 'string' ? agent.tools : ''); setBody(agent.body || ''); setScope(agent.scope === 'project' ? 'project' : 'user');
  };
  const save = async () => {
    if (!name.trim()) return; setSaving(true);
    try { const existing = selected?.readOnly ? {} : (selected?.frontmatter || {}); const frontmatter = { ...existing, name: name.trim(), description: description.trim(), model: model.trim(), thinking, tools: tools.split(',').map((item) => item.trim()).filter(Boolean) }; const response = await runtimeFetch('/api/pi/subagents/' + encodeURIComponent(name.trim()), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope, frontmatter, body }) }); if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Unable to save subagent'); const saved = await response.json() as RosterAgent; setSelected(saved); setAgents((current) => [...current.filter((item) => item.name !== saved.name), saved].sort((a, b) => a.name.localeCompare(b.name))); toast.success(t('chat.agentRoster.saved')); } catch (error) { toast.error(error instanceof Error ? error.message : t('chat.agentRoster.saveFailed')); } finally { setSaving(false); }
  };
  const run = async () => {
    const taskText = task.trim(); const selection = parseSubagentModelRef(model);
    if (!selected || !canLaunchSubagent({ task: taskText, sessionId: props.sessionId, model, modelConfirmed }) || !selection) {
      toast.error(t('chat.agentRoster.missingRunFields')); return;
    }
    setRunning(true); try { await props.onLaunch({ role: selected.name, ...selection, thinking: thinking as PiThinkingLevel, task: taskText }); setTask(''); props.onClose(); } catch (error) { toast.error(error instanceof Error ? error.message : t('chat.agentRoster.runFailed')); } finally { setRunning(false); }
  };
  const canRun = canLaunchSubagent({ task, sessionId: props.sessionId, model, modelConfirmed });
  const isEditing = editorOpen;
  return <div className='w-[min(420px,calc(100vw-1rem))] p-2 text-xs' onKeyDown={(event) => event.stopPropagation()}>
    <button type='button' className='flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted/60' onClick={() => { setEditorOpen(false); selectAgent(null); }}><Icon name='ai-agent' className='size-4 text-primary' /><span className='font-medium'>{t('chat.agentRoster.pi')}</span><span className='ml-auto text-[11px] text-muted-foreground'>{t('chat.agentRoster.currentSession')}</span></button>
    <div className='mt-2 border-t border-border/50 pt-2'><div className='flex items-center justify-between px-2 pb-1 font-semibold text-muted-foreground'><span>{t('chat.agentRoster.subagents')}</span><button type='button' className='rounded px-1.5 py-0.5 text-primary hover:bg-primary/10' onClick={() => { selectAgent(null); setEditorOpen(true); }}>{t('chat.agentRoster.new')}</button></div>
      <div className='max-h-32 overflow-y-auto'>{agents.map((agent) => <button type='button' key={agent.name} className={cn('flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-muted/60', selected?.name === agent.name && 'bg-muted')} onClick={() => selectAgent(agent)}><Icon name={agent.readOnly ? 'lock' : 'ai-agent'} className='mt-0.5 size-3.5 shrink-0 text-muted-foreground' /><span className='min-w-0'><span className='block font-medium'>{agent.name}{agent.readOnly ? ' · ' + t('chat.agentRoster.builtin') : ''}</span><span className='block truncate text-muted-foreground'>{agent.description || t('chat.agentRoster.noDescription')}</span></span></button>)}</div>
    </div>
    {isEditing && <div className='mt-2 space-y-2 border-t border-border/50 pt-2'>
      <div className='rounded-md border border-border/60 bg-muted/20 p-2'>
        <div className='mb-1.5 text-[11px] font-semibold text-muted-foreground'>{t('chat.agentRoster.launchForm')}</div>
        <div className='mb-2 flex items-center gap-2 text-xs'><Icon name='ai-agent' className='size-3.5 text-primary' /><span className='text-muted-foreground'>{t('chat.agentRoster.role')}</span><span className='font-medium'>{selected?.name || t('chat.agentRoster.role')}</span></div>
        <label className='mb-1 block text-[11px] text-muted-foreground' htmlFor='subagent-model'>{t('chat.agentRoster.model')}</label>
        <select id='subagent-model' className={control} aria-label={t('chat.agentRoster.model')} value={model} onChange={(event) => { setModel(event.target.value); setModelConfirmed(Boolean(event.target.value)); }}><option value=''>{t('chat.agentRoster.chooseModel')}</option>{models.map((entry) => <option key={entry.providerId + '/' + entry.modelId} value={entry.providerId + '/' + entry.modelId}>{entry.providerName} · {entry.modelName}</option>)}</select>
        <label className='mb-1 mt-2 block text-[11px] text-muted-foreground' htmlFor='subagent-thinking'>{t('chat.agentRoster.thinking')}</label>
        <select id='subagent-thinking' className={control} aria-label={t('chat.agentRoster.thinking')} value={thinking} onChange={(event) => setThinking(event.target.value)}>{LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</select>
        <label className='mb-1 mt-2 block text-[11px] text-muted-foreground' htmlFor='subagent-task'>{t('chat.agentRoster.task')}</label>
        <textarea id='subagent-task' className={cn(control, 'min-h-16 resize-y py-1')} aria-label={t('chat.agentRoster.task')} placeholder={t('chat.agentRoster.taskPlaceholder')} value={task} onChange={(event) => setTask(event.target.value)} />
        <button type='button' className='mt-2 w-full rounded bg-primary px-2 py-1.5 font-medium text-primary-foreground disabled:opacity-50' onClick={() => void run()} disabled={running || !canRun}>{running ? t('chat.agentRoster.running') : t('chat.agentRoster.run')}</button>
      </div>
      <div className='flex items-center gap-2'><input className={cn(control, 'flex-1')} aria-label={t('chat.agentRoster.name')} value={name} onChange={(event) => setName(event.target.value)} disabled={Boolean(selected?.readOnly)} /><select className={cn(control, 'w-24')} value={scope} onChange={(event) => setScope(event.target.value as 'user' | 'project')}><option value='user'>{t('chat.agentRoster.user')}</option><option value='project'>{t('chat.agentRoster.project')}</option></select></div>
      <input className={control} aria-label={t('chat.agentRoster.description')} placeholder={t('chat.agentRoster.description')} value={description} onChange={(event) => setDescription(event.target.value)} />
      <input className={control} aria-label={t('chat.agentRoster.tools')} placeholder={t('chat.agentRoster.tools')} value={tools} onChange={(event) => setTools(event.target.value)} />
      <textarea className={cn(control, 'min-h-16 resize-y py-1')} aria-label={t('chat.agentRoster.systemPrompt')} placeholder={t('chat.agentRoster.systemPrompt')} value={body} onChange={(event) => setBody(event.target.value)} />
      <div className='flex justify-end'><button type='button' className='rounded border border-border px-2 py-1.5 font-medium disabled:opacity-50' onClick={() => void save()} disabled={saving}>{selected?.readOnly ? t('chat.agentRoster.createOverride') : t('chat.agentRoster.save')}</button></div>
      {task.trim() && !canRun ? <p className='px-1 text-[11px] text-muted-foreground'>{t('chat.agentRoster.missingRunFields')}</p> : null}
    </div>}
  </div>;
};
