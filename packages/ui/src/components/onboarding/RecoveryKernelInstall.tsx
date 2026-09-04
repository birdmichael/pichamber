import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { copyTextToClipboard } from '@/lib/clipboard';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { KernelInstallCommand } from './KernelInstallCommand';
import {
  readLocalKernelHealth,
  recoveryKernelInstall,
  type LocalKernelName,
  type RecoveryKernelInstallSurface,
} from './localKernelSetup';

type RecoveryKernelInstallProps = {
  surface: RecoveryKernelInstallSurface;
  variant?: string | null;
};

export function RecoveryKernelInstall({ surface, variant }: RecoveryKernelInstallProps) {
  const { t } = useI18n();
  const [kernel, setKernel] = React.useState<LocalKernelName>('pi');
  const [copied, setCopied] = React.useState(false);
  const setup = recoveryKernelInstall(kernel, { surface, variant });

  React.useEffect(() => {
    if (recoveryKernelInstall('pi', { surface, variant }) === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await runtimeFetch('/health');
        if (!response.ok) return;
        const data = await response.json().catch(() => null);
        if (cancelled || !data) return;
        setKernel(readLocalKernelHealth(data).kernel);
      } catch {
        // Keep the Pi default when health is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [surface, variant]);

  const handleCopy = React.useCallback(async () => {
    if (!setup) return;
    const result = await copyTextToClipboard(setup.installCommand);
    if (result.ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [setup]);

  if (!setup) return null;

  return (
    <div className="w-full space-y-2 text-left">
      <div className="rounded-lg border border-border bg-background/60 backdrop-blur-sm px-4 py-3 font-mono text-sm">
        {copied ? (
          <div className="flex items-center gap-2" style={{ color: 'var(--status-success)' }}>
            <Icon name="check" className="h-4 w-4" />
            {t('onboarding.common.status.copiedToClipboard')}
          </div>
        ) : (
          <KernelInstallCommand
            command={setup.installCommand}
            onCopy={() => { void handleCopy(); }}
            copyTitle={t('onboarding.common.copyToClipboard')}
            layout="chooser"
          />
        )}
      </div>
      <a
        href={setup.docsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
      >
        {t('onboarding.localSetup.docs.default')}
        <Icon name="external-link" className="h-3 w-3" />
      </a>
    </div>
  );
};
