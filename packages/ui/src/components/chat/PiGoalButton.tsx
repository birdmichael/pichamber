import React from 'react';

import { PiGoalDialog } from '@/components/chat/PiGoalDialog';
import { Icon } from '@/components/icon/Icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import { getPiGoalCommand, isPiGoalComposerButtonVisible } from '@/lib/piGoal';
import { usePiKernel } from '@/lib/usePiKernel';
import { cn } from '@/lib/utils';
import { useInputStore } from '@/sync/input-store';
import { refreshFeaturePlugins, usePiFeaturePluginsStore } from '@/sync/pi-feature-plugins-store';

interface PiGoalButtonProps {
  sessionId: string | null;
  directory?: string;
  draftOpen?: boolean;
  footerIconButtonClass: string;
  iconSizeClass: string;
  withTooltip?: boolean;
}

export const PiGoalButton: React.FC<PiGoalButtonProps> = React.memo(({
  sessionId,
  directory,
  draftOpen = false,
  footerIconButtonClass,
  iconSizeClass,
  withTooltip = false,
}) => {
  const { t } = useI18n();
  const isPiKernel = usePiKernel();
  const payload = usePiFeaturePluginsStore((state) => state.payload);
  const pendingGoalSeed = useInputStore((state) => state.pendingGoalDialogSeed);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogSeed, setDialogSeed] = React.useState('');

  React.useEffect(() => {
    if (!isPiKernel) return;
    void refreshFeaturePlugins();
  }, [isPiKernel]);

  React.useEffect(() => {
    if (pendingGoalSeed === null) return;
    const seed = useInputStore.getState().consumePendingGoalDialog();
    if (seed === null) return;
    setDialogSeed(seed);
    setDialogOpen(true);
  }, [pendingGoalSeed]);

  if (!isPiKernel) {
    return null;
  }

  const showButton = isPiGoalComposerButtonVisible({ isPiKernel, payload });
  const command = getPiGoalCommand(payload);
  const label = t('chat.piGoal.buttonAria');

  const button = (
    <button
      type="button"
      className={footerIconButtonClass}
      onClick={() => {
        setDialogSeed('');
        setDialogOpen(true);
      }}
      aria-label={label}
      {...(withTooltip ? {} : { title: label })}
    >
      <Icon name="target" className={cn(iconSizeClass, 'text-current')} aria-hidden="true" />
    </button>
  );

  return (
    <>
      {showButton ? (
        withTooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>{label}</TooltipContent>
          </Tooltip>
        ) : button
      ) : null}
      <PiGoalDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setDialogSeed('');
        }}
        sessionId={sessionId}
        directory={directory}
        command={command}
        draftOpen={draftOpen}
        initialObjective={dialogSeed}
      />
    </>
  );
});

PiGoalButton.displayName = 'PiGoalButton';
