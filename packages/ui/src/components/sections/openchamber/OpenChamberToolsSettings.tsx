import * as React from 'react';

import {
  SettingsSection,
  SettingsCheckboxRow,
  SETTINGS_OPTION_STACK_CLASS,
} from '@/components/sections/shared/SettingsSection';
import { toast } from '@/components/ui';
import { reloadOpenCodeConfiguration } from '@/stores/useAgentsStore';
import { updateDesktopSettings } from '@/lib/persistence';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { useUIStore } from '@/stores/useUIStore';
import { useI18n } from '@/lib/i18n';
import { usePiKernel } from '@/lib/usePiKernel';
import { shouldShowAgentControlToolSettings } from '@/lib/settings/pichamberToolsVisibility';

/**
 * Which host tools agents are given.
 *
 * On leftover OpenCode this is the managed-child plugin set. On Pi Desktop
 * both rows are host `defineTool`s (`pichamber` and `pichamber_web`).
 *
 * A toggle is written immediately, then idle Pi sessions reload (or leftover
 * OpenCode restarts) so the change reaches agents without a deferred banner.
 */
export const OpenChamberToolsSettings: React.FC = () => {
  const { t } = useI18n();
  const isPiKernel = usePiKernel();
  const showAgentControl = shouldShowAgentControlToolSettings({ isVSCode: false });
  const agentControlToolEnabled = useUIStore((state) => state.agentControlToolEnabled);
  const setAgentControlToolEnabled = useUIStore((state) => state.setAgentControlToolEnabled);
  const agentWebToolEnabled = useUIStore((state) => state.agentWebToolEnabled);
  const setAgentWebToolEnabled = useUIStore((state) => state.setAgentWebToolEnabled);

  const reloadAfterToolToggle = React.useCallback(async () => {
    if (isPiKernel) {
      const response = await runtimeFetch('/api/pi/sessions/reload-idle', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || t('settings.view.pendingRestart.applyFailed'));
      }
      return;
    }
    await reloadOpenCodeConfiguration({
      message: t('settings.openchamber.opencodeCli.actions.restartingOpenCode'),
    });
  }, [isPiKernel, t]);

  const handleAgentControlToolChange = React.useCallback((enabled: boolean) => {
    setAgentControlToolEnabled(enabled);
    void (async () => {
      try {
        await updateDesktopSettings({ agentControlToolEnabled: enabled });
        await reloadAfterToolToggle();
        toast.success(t('settings.openchamber.opencodeCli.toast.savedReloaded'));
      } catch (error) {
        const message = error instanceof Error && error.message
          ? error.message
          : t('settings.view.pendingRestart.applyFailed');
        toast.error(message);
      }
    })();
  }, [reloadAfterToolToggle, setAgentControlToolEnabled, t]);

  const handleAgentWebToolChange = React.useCallback((enabled: boolean) => {
    setAgentWebToolEnabled(enabled);
    void (async () => {
      try {
        await updateDesktopSettings({ agentWebToolEnabled: enabled });
        await reloadAfterToolToggle();
        toast.success(t('settings.openchamber.opencodeCli.toast.savedReloaded'));
      } catch (error) {
        const message = error instanceof Error && error.message
          ? error.message
          : t('settings.view.pendingRestart.applyFailed');
        toast.error(message);
      }
    })();
  }, [reloadAfterToolToggle, setAgentWebToolEnabled, t]);

  return (
    <SettingsSection title={t('settings.openchamber.tools.title')}>
      <div className={SETTINGS_OPTION_STACK_CLASS}>
        {showAgentControl && (
          <SettingsCheckboxRow
            settingsItem="sessions.agent-control-tool"
            checked={agentControlToolEnabled}
            onChange={handleAgentControlToolChange}
            label={t('settings.openchamber.tools.field.agentControlTool')}
            ariaLabel={t('settings.openchamber.tools.field.agentControlToolAria')}
            info={t('settings.openchamber.tools.field.agentControlToolInfo')}
          />
        )}

        <SettingsCheckboxRow
          settingsItem="sessions.agent-web-tool"
          checked={agentWebToolEnabled}
          onChange={handleAgentWebToolChange}
          label={t('settings.openchamber.tools.field.agentWebTool')}
          ariaLabel={t('settings.openchamber.tools.field.agentWebToolAria')}
          info={t('settings.openchamber.tools.field.agentWebToolInfo')}
        />
      </div>
    </SettingsSection>
  );
};
