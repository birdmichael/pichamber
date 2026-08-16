import React from 'react';

import { PiGoalDialog } from '@/components/chat/PiGoalDialog';
import { Icon } from '@/components/icon/Icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import { getPiGoalCommand, isPiGoalComposerButtonVisible } from '@/lib/piGoal';
import { usePiKernel } from '@/lib/usePiKernel';
import { cn } from '@/lib/utils';
import { refreshFeaturePlugins, usePiFeaturePluginsStore } from '@/sync/pi-feature-plugins-store';

interface PiGoalButtonProps {
  sessionId: string | null;
  directory?: string;
  footerIconButtonClass: string;
  iconSizeClass: string;
  withTooltip?: boolean;
}

export const PiGoalButton: React.FC<PiGoalButtonProps> = React.memo(({
  sessionId,
  directory,
  footerIconButtonClass,
  iconSizeClass,
  withTooltip = false,
}) => {
  const { t } = useI18n();
  const isPiKernel = usePiKernel();
  const payload = usePiFeaturePluginsStore((state) => state.payload);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  React.useEffect(() => {
    if (!isPiKernel) return;
    void refreshFeaturePlugins();
  }, [isPiKernel]);

  if (!isPiGoalComposerButtonVisible({ isPiKernel, payload })) {
    return null;
  }

  const command = getPiGoalCommand(payload);
  const label = t('chat.piGoal.buttonAria');

  const button = (
    <button
      type="button"
      className={footerIconButtonClass}
      onClick={() => setDialogOpen(true)}
      aria-label={label}
      {...(withTooltip ? {} : { title: label })}
    >
      <Icon name="target" className={cn(iconSizeClass, 'text-current')} aria-hidden="true" />
    </button>
  );

  return (
    <>
      {withTooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>{label}</TooltipContent>
        </Tooltip>
      ) : button}
      <PiGoalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        sessionId={sessionId}
        directory={directory}
        command={command}
      />
    </>
  );
});

PiGoalButton.displayName = 'PiGoalButton';
