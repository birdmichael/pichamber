import React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { useSettingsDirectory } from '@/hooks/useSettingsDirectory';
import { useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';

type PromptFile = { content?: string; exists?: boolean; path?: string; scope?: string };
type PromptPayload = PromptFile & { project?: PromptFile };

export const PiPromptStack: React.FC = () => {
  const { t } = useI18n();
  const directory = useSettingsDirectory();
  const [user, setUser] = React.useState('');
  const [project, setProject] = React.useState('');
  const [loaded, setLoaded] = React.useState<PromptPayload | null>(null);
  const [saving, setSaving] = React.useState<string | null>(null);
  const query = directory?.trim() ? `?directory=${encodeURIComponent(directory.trim())}` : '';
  const load = React.useCallback(async () => {
    const response = await runtimeFetch(`/api/behavior/agents-md${query}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const payload = await response.json() as PromptPayload;
    setLoaded(payload); setUser(payload.content || ''); setProject(payload.project?.content || '');
  }, [query]);
  React.useEffect(() => { void load(); }, [load]);
  const save = async (scope: 'user' | 'project', content: string) => {
    setSaving(scope);
    try {
      const response = await runtimeFetch('/api/behavior/agents-md', { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ content, scope, directory }) });
      if (!response.ok) throw new Error('save failed');
      toast.success(t('settings.behavior.page.toast.saved')); await load();
    } catch { toast.error(t('settings.behavior.page.toast.saveFailed')); } finally { setSaving(null); }
  };
  const projectAvailable = Boolean(directory?.trim());
  return <SettingsSection title={t('settings.piAgents.agentsMd')} contentClassName="space-y-3">
    <p className="typography-meta text-muted-foreground">{t('settings.piAgents.agentsMdInfo')}</p>
    <Textarea value={user} onChange={(event) => setUser(event.target.value)} rows={8} placeholder={t('settings.behavior.page.field.systemPromptPlaceholder')} className="w-full font-mono typography-meta bg-transparent" />
    <p className="typography-meta text-muted-foreground">{loaded?.path || '~/.pi/agent/AGENTS.md'}</p>
    <Button size="xs" onClick={() => void save('user', user)} disabled={saving === 'user'}>{saving === 'user' ? t('settings.common.actions.saving') : t('settings.common.actions.saveChanges')}</Button>
    {projectAvailable ? <><p className="pt-2 typography-meta font-medium text-muted-foreground">{t('settings.piAgents.projectAgentsMd')}</p><Textarea value={project} onChange={(event) => setProject(event.target.value)} rows={8} placeholder={t('settings.behavior.page.field.systemPromptPlaceholder')} className="w-full font-mono typography-meta bg-transparent" /><p className="typography-meta text-muted-foreground">{loaded?.project?.path || `${directory}/AGENTS.md`}</p><Button size="xs" onClick={() => void save('project', project)} disabled={saving === 'project'}>{saving === 'project' ? t('settings.common.actions.saving') : t('settings.common.actions.saveChanges')}</Button></> : null}
  </SettingsSection>;
};
