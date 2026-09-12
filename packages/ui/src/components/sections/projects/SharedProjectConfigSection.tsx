import React from 'react';
import { toast } from 'sonner';

import { Input } from '@/components/ui/input';
import { ProjectSettingsSubsection } from '@/components/sections/projects/ProjectSettingsSubsection';
import { SettingsFieldRow } from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import {
  readSharedProjectConfig,
  updateSharedProjectPlansDir,
} from '@/lib/openchamberConfig';
import type { ProjectRef } from '@/lib/openchamberConfig';
import {
  SHARED_CONFIG_RELATIVE_PATH,
  type SharedProjectConfigRead,
} from '@/lib/sharedProjectConfig';

type SharedProjectConfigSectionProps = {
  projectRef: ProjectRef;
};

/**
 * Repository config for this project: where `.pichamber/project.json` is, whether
 * it could be read, and the shared plans folder pointer. Sharing actions / setup
 * commands / starters lands in a follow-up port; this block can create the file
 * when a plans folder is set.
 */
export const SharedProjectConfigSection: React.FC<SharedProjectConfigSectionProps> = ({ projectRef }) => {
  const { t } = useI18n();
  const [shared, setShared] = React.useState<SharedProjectConfigRead | null>(null);
  const [plansDirDraft, setPlansDirDraft] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void readSharedProjectConfig(projectRef).then((next) => {
      if (cancelled) return;
      setShared(next);
      setPlansDirDraft(next.status === 'ok' ? (next.config.plansDir ?? '') : '');
    });
    return () => {
      cancelled = true;
    };
  }, [projectRef]);

  const savePlansDir = React.useCallback(async () => {
    if (!shared) return;
    const current = shared.status === 'ok' ? (shared.config.plansDir ?? '') : '';
    const next = plansDirDraft.trim();
    if (next === current) return;
    setIsSaving(true);
    try {
      const saved = await updateSharedProjectPlansDir(projectRef, next || null);
      if (!saved) {
        toast.error(t('settings.projects.shared.toast.shareFailed'));
        setPlansDirDraft(current);
        return;
      }
      setShared(saved);
      setPlansDirDraft(saved.status === 'ok' ? (saved.config.plansDir ?? '') : '');
    } finally {
      setIsSaving(false);
    }
  }, [plansDirDraft, projectRef, shared, t]);

  if (!shared) {
    return null;
  }

  const path = shared.path || SHARED_CONFIG_RELATIVE_PATH;
  const status = shared.status === 'invalid'
    ? t('settings.projects.shared.invalid', { path, reason: shared.reason ?? '' })
    : shared.status === 'ok'
      ? t('settings.projects.shared.status.ok')
      : t('settings.projects.shared.status.missing');

  return (
    <ProjectSettingsSubsection
      title={t('settings.projects.shared.title')}
      info={t('settings.projects.shared.description')}
      settingsItem="projects.shared"
    >
      <SettingsFieldRow label={t('settings.projects.shared.file')}>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-mono text-xs text-foreground">{path}</span>
          <span className={shared.status === 'invalid' ? 'typography-meta text-[var(--status-warning)]' : 'typography-meta text-muted-foreground'}>
            {status}
          </span>
        </div>
      </SettingsFieldRow>

      <SettingsFieldRow
        label={t('settings.projects.shared.plansDir')}
        info={t('settings.projects.shared.plansDirInfo')}
        settingsItem="projects.shared.plansDir"
      >
        <Input
          value={plansDirDraft}
          onChange={(event) => setPlansDirDraft(event.target.value)}
          onBlur={() => void savePlansDir()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
          placeholder={t('settings.projects.shared.plansDirPlaceholder')}
          aria-label={t('settings.projects.shared.plansDirAria')}
          disabled={isSaving}
          className="h-8 rounded-md px-3 font-mono text-xs"
        />
      </SettingsFieldRow>
    </ProjectSettingsSubsection>
  );
};
