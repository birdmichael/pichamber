import React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';

type PromptFile = { path: string; exists: boolean; content: string };
type SystemPromptFiles = {
  global: { replace: PromptFile; append: PromptFile };
  project: { replace: PromptFile; append: PromptFile } | null;
};

const emptyFile = (): PromptFile => ({ path: '', exists: false, content: '' });

export const SystemMdSettings: React.FC = () => {
  const { t } = useI18n();
  const [files, setFiles] = React.useState<SystemPromptFiles | null>(null);
  const [globalReplace, setGlobalReplace] = React.useState('');
  const [globalAppend, setGlobalAppend] = React.useState('');
  const [projectReplace, setProjectReplace] = React.useState('');
  const [projectAppend, setProjectAppend] = React.useState('');
  const [saving, setSaving] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await runtimeFetch('/api/behavior/system-md', { headers: { Accept: 'application/json' } });
        if (!response.ok) return;
        const data = await response.json() as SystemPromptFiles;
        if (cancelled) return;
        setFiles(data);
        setGlobalReplace(data.global?.replace?.content ?? '');
        setGlobalAppend(data.global?.append?.content ?? '');
        setProjectReplace(data.project?.replace?.content ?? '');
        setProjectAppend(data.project?.append?.content ?? '');
      } catch {
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const save = async (kind: 'replace' | 'append', scope: 'user' | 'project', content: string) => {
    const key = `${kind}:${scope}`;
    setSaving(key);
    try {
      const response = await runtimeFetch(kind === 'append' ? '/api/behavior/append-system-md' : '/api/behavior/system-md', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, scope, content }),
      });
      if (!response.ok) {
        throw new Error('save failed');
      }
      toast.success(t('settings.behavior.page.toast.saved'));
    } catch {
      toast.error(t('settings.behavior.page.toast.saveFailed'));
    } finally {
      setSaving(null);
    }
  };

  const global = files?.global ?? { replace: emptyFile(), append: emptyFile() };
  const project = files?.project ?? null;

  return (
    <>
      <SettingsSection
        title={t('settings.behavior.page.section.systemMd')}
        info={t('settings.behavior.page.systemMd.global')}
        settingsItem="behavior.system-md"
        contentClassName="space-y-3"
      >
        <p className="typography-meta text-muted-foreground">{t('settings.behavior.page.systemMd.global')}</p>
        <Textarea
          value={globalReplace}
          onChange={(event) => setGlobalReplace(event.target.value)}
          placeholder={t('settings.behavior.page.field.systemMdPlaceholder')}
          rows={8}
          outerClassName="min-h-[120px] max-h-[50vh]"
          className="w-full font-mono typography-meta bg-transparent"
        />
        <Button
          size="xs"
          className="!font-normal"
          disabled={saving === 'replace:user' || globalReplace === (global.replace.content ?? '')}
          onClick={() => void save('replace', 'user', globalReplace)}
        >
          {saving === 'replace:user' ? t('settings.common.actions.saving') : t('settings.common.actions.saveChanges')}
        </Button>
        {project ? (
          <>
            <p className="typography-meta text-muted-foreground">{t('settings.behavior.page.systemMd.project')}</p>
            <Textarea
              value={projectReplace}
              onChange={(event) => setProjectReplace(event.target.value)}
              placeholder={t('settings.behavior.page.field.systemMdPlaceholder')}
              rows={8}
              outerClassName="min-h-[120px] max-h-[50vh]"
              className="w-full font-mono typography-meta bg-transparent"
            />
            <Button
              size="xs"
              className="!font-normal"
              disabled={saving === 'replace:project' || projectReplace === (project.replace.content ?? '')}
              onClick={() => void save('replace', 'project', projectReplace)}
            >
              {saving === 'replace:project' ? t('settings.common.actions.saving') : t('settings.common.actions.saveChanges')}
            </Button>
          </>
        ) : null}
      </SettingsSection>
      <SettingsSection
        title={t('settings.behavior.page.section.appendSystemMd')}
        info={t('settings.behavior.page.systemMd.global')}
        settingsItem="behavior.append-system-md"
        contentClassName="space-y-3"
      >
        <p className="typography-meta text-muted-foreground">{t('settings.behavior.page.systemMd.global')}</p>
        <Textarea
          value={globalAppend}
          onChange={(event) => setGlobalAppend(event.target.value)}
          placeholder={t('settings.behavior.page.field.appendSystemMdPlaceholder')}
          rows={6}
          outerClassName="min-h-[100px] max-h-[40vh]"
          className="w-full font-mono typography-meta bg-transparent"
        />
        <Button
          size="xs"
          className="!font-normal"
          disabled={saving === 'append:user' || globalAppend === (global.append.content ?? '')}
          onClick={() => void save('append', 'user', globalAppend)}
        >
          {saving === 'append:user' ? t('settings.common.actions.saving') : t('settings.common.actions.saveChanges')}
        </Button>
        {project ? (
          <>
            <p className="typography-meta text-muted-foreground">{t('settings.behavior.page.systemMd.project')}</p>
            <Textarea
              value={projectAppend}
              onChange={(event) => setProjectAppend(event.target.value)}
              placeholder={t('settings.behavior.page.field.appendSystemMdPlaceholder')}
              rows={6}
              outerClassName="min-h-[100px] max-h-[40vh]"
              className="w-full font-mono typography-meta bg-transparent"
            />
            <Button
              size="xs"
              className="!font-normal"
              disabled={saving === 'append:project' || projectAppend === (project.append.content ?? '')}
              onClick={() => void save('append', 'project', projectAppend)}
            >
              {saving === 'append:project' ? t('settings.common.actions.saving') : t('settings.common.actions.saveChanges')}
            </Button>
          </>
        ) : null}
      </SettingsSection>
    </>
  );
};
