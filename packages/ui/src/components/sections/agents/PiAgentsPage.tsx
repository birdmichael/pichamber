import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Icon } from '@/components/icon/Icon';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { SystemMdSettings } from '@/components/sections/behavior/SystemMdSettings';
import { PiPromptStack } from './PiPromptStack';
import { mergePiToolsChecklist } from './piAgentTools';
import { useUIStore } from '@/stores/useUIStore';
import { useSettingsDirectory } from '@/hooks/useSettingsDirectory';
import { useFeaturePluginSlotActive } from '@/stores/useFeaturePluginSlotsStore';
import { usePiAgentsStore } from '@/stores/usePiAgentsStore';
import { useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { cn } from '@/lib/utils';
import { useConfigStore } from '@/stores/useConfigStore';
import { normalizePiModelProviders } from '@/lib/multirun/piModels';
import type { ModelPickerProvider } from '@/components/model-picker/ModelPickerList';
import { SETTINGS_ESCAPE_FORM_EVENT } from '@/lib/settings-dismiss';

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
type PiSkill = { name?: string; description?: string };
const arrayValue = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];

export const PiAgentsPage: React.FC = () => {
  const { t } = useI18n();
  const directory = useSettingsDirectory();
  const active = useFeaturePluginSlotActive('subagents', true);
  const providersFromConfig = useConfigStore((state) => state.providers);
  const { agents, selectedName, isCreating, load, save, remove, cancelCreating } = usePiAgentsStore();
  const setSettingsPage = useUIStore((state) => state.setSettingsPage);
  const selected = selectedName ? agents.find((agent) => agent.name === selectedName) ?? null : null;
  const [name, setName] = React.useState('');
  const [scope, setScope] = React.useState<'user' | 'project'>('user');
  const [description, setDescription] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [model, setModel] = React.useState('');
  const [thinking, setThinking] = React.useState('');
  const [tools, setTools] = React.useState<string[]>([]);
  const [skills, setSkills] = React.useState<string[]>([]);
  const [body, setBody] = React.useState('');
  const [promptMode, setPromptMode] = React.useState('append');
  const [extensions, setExtensions] = React.useState('');
  const [disallowedTools, setDisallowedTools] = React.useState<string[]>([]);
  const [memory, setMemory] = React.useState('');
  const [isolation, setIsolation] = React.useState('');
  const [maxTurns, setMaxTurns] = React.useState('');
  const [skillsCatalog, setSkillsCatalog] = React.useState<PiSkill[]>([]);
  const [models, setModels] = React.useState<ModelPickerProvider[]>(() => normalizePiModelProviders({ providers: providersFromConfig }));
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);

  React.useEffect(() => { if (active) void load(directory); }, [active, directory, load]);
  React.useEffect(() => { setModels(normalizePiModelProviders({ providers: providersFromConfig })); }, [providersFromConfig]);
  React.useEffect(() => {
    if (!active) return;
    void runtimeFetch('/api/pi/models').then(async (response) => { const payload = await response.json().catch(() => null); if (response.ok && Array.isArray(payload?.providers)) setModels(normalizePiModelProviders(payload)); }).catch(() => undefined);
    void runtimeFetch(`/api/pi/skills${directory?.trim() ? `?directory=${encodeURIComponent(directory.trim())}` : ''}`).then(async (response) => { const payload = await response.json().catch(() => null); if (response.ok && Array.isArray(payload?.skills)) setSkillsCatalog(payload.skills as PiSkill[]); }).catch(() => undefined);
  }, [active, directory]);
  React.useEffect(() => {
    if (isCreating) { setName(''); setScope('user'); setDescription(''); setDisplayName(''); setModel(''); setThinking(''); setTools([]); setSkills([]); setBody(''); setPromptMode('append'); setExtensions(''); setDisallowedTools([]); setMemory(''); setIsolation(''); setMaxTurns(''); return; }
    if (!selected) { setName(''); setDescription(''); setDisplayName(''); setModel(''); setThinking(''); setTools([]); setSkills([]); setBody(''); setPromptMode('append'); setExtensions(''); setDisallowedTools([]); setMemory(''); setIsolation(''); setMaxTurns(''); return; }
    const fm = selected.frontmatter || {};
    setName(selected.name); setScope(selected.scope === 'project' ? 'project' : 'user'); setDescription(selected.description || ''); setDisplayName(typeof fm.display_name === 'string' ? fm.display_name : ''); setModel(selected.model || ''); setThinking(selected.thinking || ''); setTools(arrayValue(selected.tools)); setSkills(arrayValue(fm.skills)); setBody(selected.body || ''); setPromptMode(typeof fm.prompt_mode === 'string' ? fm.prompt_mode : 'append'); setExtensions(arrayValue(fm.extensions).join(', ')); setDisallowedTools(arrayValue(fm.disallowed_tools)); setMemory(typeof fm.memory === 'string' ? fm.memory : ''); setIsolation(typeof fm.isolation === 'string' ? fm.isolation : ''); setMaxTurns(typeof fm.max_turns === 'number' ? String(fm.max_turns) : '');
  }, [isCreating, selected]);

  const abandonNewDraft = React.useCallback(() => {
    cancelCreating();
  }, [cancelCreating]);

  const formRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const form = formRef.current;
    if (!isCreating || !form) {
      return;
    }
    const onAbandon = () => {
      abandonNewDraft();
    };
    form.addEventListener(SETTINGS_ESCAPE_FORM_EVENT, onAbandon);
    return () => {
      form.removeEventListener(SETTINGS_ESCAPE_FORM_EVENT, onAbandon);
    };
  }, [abandonNewDraft, isCreating]);

  // Must stay above early returns: Create agent toggles past the explainer path and
  // would otherwise change hook count (React #310 / #672).
  const toolsChecklist = React.useMemo(
    () => mergePiToolsChecklist([...tools, ...disallowedTools]),
    [tools, disallowedTools],
  );

  if (!active) return <SettingsPageLayout title={t('settings.piAgents.title')} description={t('settings.piAgents.pluginRequired')} showSaveStatus={false}><div className="rounded-lg border border-dashed p-6 typography-body text-muted-foreground">{t('settings.piAgents.pluginRequired')}</div></SettingsPageLayout>;
  if (!isCreating && !selectedName) return <SettingsPageLayout title={t('settings.piAgents.piRow')} description={t('settings.piAgents.piRowDescription')} showSaveStatus={false}><div className="space-y-4"><div className="rounded-lg border p-5"><div className="flex items-center gap-2 font-medium"><Icon name="ai-agent" className="h-4 w-4 text-primary" />{t('settings.piAgents.piRow')}</div><p className="mt-2 typography-body text-muted-foreground">{t('settings.piAgents.piExplainer')}</p><Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setSettingsPage('behavior')}>{t('settings.piAgents.openPromptStack')}</Button></div><SystemMdSettings /><PiPromptStack /></div></SettingsPageLayout>;

  const readOnly = Boolean(selected?.readOnly);
  const toggle = (value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => setter((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  const options = models.flatMap((provider) => (provider.id ? (provider.models || []).flatMap((entry) => provider.id && entry.id ? [{ value: `${provider.id}/${entry.id}`, label: `${provider.name || provider.id} · ${entry.name || entry.id}` }] : []) : []));
  const saveAgent = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) { toast.error(t('settings.piAgents.required')); return; }
    setSaving(true);
    try {
      const existing = selected?.frontmatter || {};
      const frontmatter: Record<string, unknown> = readOnly ? { name: trimmedName, description: description.trim() } : { ...existing, name: trimmedName, description: description.trim(), display_name: displayName.trim(), tools, skills, prompt_mode: promptMode, extensions: arrayValue(extensions), disallowed_tools: disallowedTools, memory: memory.trim(), isolation: isolation.trim() };
      if (!readOnly) { if (model.trim()) frontmatter.model = model.trim(); else delete frontmatter.model; if (thinking) frontmatter.thinking = thinking; else delete frontmatter.thinking; if (maxTurns.trim()) frontmatter.max_turns = Number(maxTurns); else delete frontmatter.max_turns; }
      await save({ name: trimmedName, scope, frontmatter, body: readOnly ? (selected?.body || '') : body }, directory);
      toast.success(readOnly ? t('settings.piAgents.descriptionSaved') : (isCreating ? t('settings.piAgents.created') : t('settings.piAgents.saved')));
    } catch (error) { toast.error(error instanceof Error ? error.message : t('settings.piAgents.saveFailed')); }
    finally { setSaving(false); }
  };
  // Native window.confirm freezes the Electron renderer (CDP/Runtime.evaluate hang).
  const requestDeleteAgent = () => {
    if (!selected || selected.readOnly) return;
    setDeleteConfirmOpen(true);
  };
  const confirmDeleteAgent = async () => {
    if (!selected || selected.readOnly) return;
    setDeleting(true);
    try {
      await remove(selected, directory);
      setDeleteConfirmOpen(false);
      toast.success(t('settings.piAgents.deleted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.piAgents.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };
  const disabled = readOnly;

  return (
    <>
      <SettingsPageLayout title={isCreating ? t('settings.piAgents.new') : name} description={readOnly ? t('settings.piAgents.readOnly') : t('settings.piAgents.editDescription')} showSaveStatus={false}>
        <div
          ref={formRef}
          className="space-y-4"
          data-settings-escape-form={isCreating ? 'true' : undefined}
          onKeyDown={(event) => {
            if (!isCreating || event.key !== 'Escape') {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            abandonNewDraft();
          }}
        >
          <SettingsSection title={t('settings.piAgents.basics')} divider={false} contentClassName="space-y-3">
            <label className="block typography-ui-label">{t('settings.piAgents.name')}<Input value={name} onChange={(event) => setName(event.target.value)} disabled={disabled || !isCreating} placeholder="researcher" className="mt-1 max-w-md" /></label>
            <label className="block typography-ui-label">{t('settings.piAgents.displayName')}<Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={disabled} className="mt-1 max-w-md" /></label>
            <label className="block typography-ui-label">{t('settings.piAgents.description')}<Input value={description} onChange={(event) => setDescription(event.target.value)} disabled={false} className="mt-1" /></label>
            <label className="block typography-ui-label">{t('settings.piAgents.scope')}<select value={scope} onChange={(event) => setScope(event.target.value as 'user' | 'project')} disabled={disabled || !isCreating} className="mt-1 block h-8 rounded-md border border-border bg-background px-2 text-sm"><option value="user">{t('settings.piAgents.user')}</option><option value="project">{t('settings.piAgents.project')}</option></select></label>
          </SettingsSection>
          <SettingsSection title={t('settings.piAgents.capabilities')} contentClassName="space-y-4">
            <div><p className="mb-2 typography-ui-label">{t('settings.piAgents.tools')}</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{toolsChecklist.map((tool) => <label key={tool} className={cn('flex items-center gap-2 rounded border px-2 py-1.5 typography-meta', disabled && 'opacity-60')}><input type="checkbox" checked={tools.includes(tool)} onChange={() => toggle(tool, setTools)} disabled={disabled} />{tool}</label>)}</div></div>
            <div><p className="mb-2 typography-ui-label">{t('settings.piAgents.skills')}</p>{skillsCatalog.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{skillsCatalog.map((skill) => skill.name ? <label key={skill.name} className={cn('flex items-center gap-2 rounded border px-2 py-1.5 typography-meta', disabled && 'opacity-60')} title={skill.description}><input type="checkbox" checked={skills.includes(skill.name)} onChange={() => toggle(skill.name as string, setSkills)} disabled={disabled} />{skill.name}</label> : null)}</div> : <p className="typography-meta text-muted-foreground">{t('settings.piAgents.skillsUnavailable')}</p>}</div>
          </SettingsSection>
          <SettingsSection title={t('settings.piAgents.prompt')} contentClassName="space-y-3"><label className="block typography-ui-label">{t('settings.piAgents.promptMode')}<select value={promptMode} onChange={(event) => setPromptMode(event.target.value)} disabled={disabled} className="mt-1 block h-8 rounded-md border border-border bg-background px-2 text-sm"><option value="append">append</option><option value="replace">replace</option><option value="replace-all">replace-all</option></select></label><Textarea value={body} onChange={(event) => setBody(event.target.value)} disabled={disabled} rows={10} placeholder={t('settings.piAgents.promptPlaceholder')} /><p className="typography-meta text-muted-foreground">{t('settings.piAgents.promptInfo')}</p></SettingsSection>
          <details className="rounded-lg border p-3"><summary className="cursor-pointer typography-ui-label">{t('settings.piAgents.advanced')}</summary><div className="mt-3 space-y-3"><label className="block typography-ui-label">{t('settings.piAgents.defaultModel')}<select value={model} onChange={(event) => setModel(event.target.value)} disabled={disabled} className="mt-1 block h-8 w-full rounded-md border border-border bg-background px-2 text-sm"><option value="">{t('settings.piAgents.inherit')}</option>{options.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label><label className="block typography-ui-label">{t('settings.piAgents.thinking')}<select value={thinking} onChange={(event) => setThinking(event.target.value)} disabled={disabled} className="mt-1 block h-8 rounded-md border border-border bg-background px-2 text-sm"><option value="">{t('settings.piAgents.inherit')}</option>{THINKING_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</select></label><label className="block typography-ui-label">{t('settings.piAgents.extensions')}<Input value={extensions} onChange={(event) => setExtensions(event.target.value)} disabled={disabled} className="mt-1" placeholder="comma-separated" /></label><label className="block typography-ui-label">{t('settings.piAgents.memory')}<Input value={memory} onChange={(event) => setMemory(event.target.value)} disabled={disabled} className="mt-1" /></label><label className="block typography-ui-label">{t('settings.piAgents.isolation')}<Input value={isolation} onChange={(event) => setIsolation(event.target.value)} disabled={disabled} className="mt-1" /></label><label className="block typography-ui-label">{t('settings.piAgents.maxTurns')}<Input type="number" min="0" value={maxTurns} onChange={(event) => setMaxTurns(event.target.value)} disabled={disabled} className="mt-1 max-w-32" /></label><div><p className="mb-2 typography-ui-label">{t('settings.piAgents.disallowedTools')}</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{toolsChecklist.map((tool) => <label key={tool} className="flex items-center gap-2 typography-meta"><input type="checkbox" checked={disallowedTools.includes(tool)} onChange={() => toggle(tool, setDisallowedTools)} disabled={disabled} />{tool}</label>)}</div></div></div></details>
          <div className="flex justify-end gap-2">{selected && !readOnly && <Button type="button" variant="destructive" onClick={requestDeleteAgent} disabled={deleting}>{t('settings.piAgents.delete')}</Button>}{isCreating && <Button type="button" variant="ghost" onClick={cancelCreating}>{t('settings.piAgents.cancel')}</Button>}<Button type="button" onClick={() => void saveAgent()} disabled={saving}>{saving ? t('settings.piAgents.saving') : readOnly ? t('settings.piAgents.saveDescription') : t('settings.piAgents.save')}</Button></div>
        </div>
      </SettingsPageLayout>
      <Dialog open={deleteConfirmOpen} onOpenChange={(open) => { if (!deleting) setDeleteConfirmOpen(open); }}>
        <DialogContent className="max-w-md" aria-label={t('settings.piAgents.confirmDelete', { name: selected?.name ?? name })}>
          <DialogHeader>
            <DialogTitle>{t('settings.piAgents.delete')}</DialogTitle>
            <DialogDescription>{t('settings.piAgents.confirmDelete', { name: selected?.name ?? name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>{t('settings.common.actions.cancel')}</Button>
            <Button type="button" variant="destructive" size="sm" onClick={() => void confirmDeleteAgent()} disabled={deleting}>{t('settings.common.actions.delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
