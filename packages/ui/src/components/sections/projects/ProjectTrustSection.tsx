import React from 'react';
import {
  SettingsCheckboxRow,
  SettingsFieldRow,
  SETTINGS_SELECT_ROW_TRIGGER_CLASS,
  SETTINGS_SELECT_SIZE,
} from '@/components/sections/shared/SettingsSection';
import { ProjectSettingsSubsection } from '@/components/sections/projects/ProjectSettingsSubsection';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { reportSettingsSaveState } from '@/lib/persistence';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { useI18n } from '@/lib/i18n';
import { usePiKernel } from '@/lib/usePiKernel';
import type { ProjectEntry } from '@/lib/api/types';

type TrustPayload = {
  defaultProjectTrust?: 'ask' | 'always' | 'never';
  current?: { path?: string; trusted?: boolean | null };
};

const TRUST_OPTIONS = ['ask', 'always', 'never'] as const;

export const ProjectTrustSection: React.FC<{ project: ProjectEntry }> = ({ project }) => {
  const { t } = useI18n();
  const isPiKernel = usePiKernel();
  const [trusted, setTrusted] = React.useState(false);
  const [defaultProjectTrust, setDefaultProjectTrust] = React.useState<(typeof TRUST_OPTIONS)[number]>('ask');
  const [ready, setReady] = React.useState(false);

  const persist = React.useCallback(async (fn: () => Promise<void>) => {
    reportSettingsSaveState('saving');
    try {
      await fn();
      reportSettingsSaveState('saved');
    } catch {
      reportSettingsSaveState('error');
    }
  }, []);

  React.useEffect(() => {
    if (!isPiKernel) return;
    let cancelled = false;
    void runtimeFetch('/api/pi/trust', {
      method: 'GET',
      query: { directory: project.path },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: TrustPayload | null) => {
        if (cancelled || !payload) return;
        if (payload.defaultProjectTrust === 'ask' || payload.defaultProjectTrust === 'always' || payload.defaultProjectTrust === 'never') {
          setDefaultProjectTrust(payload.defaultProjectTrust);
        }
        setTrusted(payload.current?.trusted === true);
        setReady(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isPiKernel, project.path]);

  if (!isPiKernel || !ready) {
    return null;
  }

  return (
    <ProjectSettingsSubsection
      title={t('settings.projects.page.section.trust')}
      settingsItem="projects.trust"
    >
      <SettingsCheckboxRow
        settingsItem="projects.trust-this-project"
        checked={trusted}
        onChange={(checked) => {
          setTrusted(checked);
          void persist(async () => {
            const response = await runtimeFetch('/api/pi/trust', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ directory: project.path, trusted: checked }),
            });
            if (!response.ok) throw new Error('trust write failed');
          });
        }}
        label={t('settings.projects.page.field.trustThisProject')}
        ariaLabel={t('settings.projects.page.field.trustThisProjectAria')}
        info={t('settings.projects.page.field.trustThisProjectInfo')}
      />
      <SettingsFieldRow
        settingsItem="projects.default-trust"
        label={t('settings.projects.page.field.defaultProjectTrust')}
        info={t('settings.projects.page.field.defaultProjectTrustInfo')}
      >
        <Select
          value={defaultProjectTrust}
          onValueChange={(value) => {
            const next = TRUST_OPTIONS.includes(value as typeof defaultProjectTrust)
              ? value as typeof defaultProjectTrust
              : 'ask';
            setDefaultProjectTrust(next);
            void persist(async () => {
              const response = await runtimeFetch('/api/pi/trust', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ defaultProjectTrust: next }),
              });
              if (!response.ok) throw new Error('default trust write failed');
            });
          }}
        >
          <SelectTrigger
            size={SETTINGS_SELECT_SIZE}
            className={SETTINGS_SELECT_ROW_TRIGGER_CLASS}
            aria-label={t('settings.projects.page.field.defaultProjectTrustAria')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ask">{t('settings.projects.page.option.trustAsk')}</SelectItem>
            <SelectItem value="always">{t('settings.projects.page.option.trustAlways')}</SelectItem>
            <SelectItem value="never">{t('settings.projects.page.option.trustNever')}</SelectItem>
          </SelectContent>
        </Select>
      </SettingsFieldRow>
    </ProjectSettingsSubsection>
  );
};
