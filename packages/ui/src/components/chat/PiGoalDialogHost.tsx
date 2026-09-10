import React from 'react';

import { PiGoalDialog } from '@/components/chat/PiGoalDialog';
import { getPiGoalCommand } from '@/lib/piGoal';
import { usePiKernel } from '@/lib/usePiKernel';
import { useInputStore } from '@/sync/input-store';
import { refreshFeaturePlugins, usePiFeaturePluginsStore } from '@/sync/pi-feature-plugins-store';
import { useSessionUIStore } from '@/sync/session-ui-store';

/**
 * Always-mounted Goal dialog consumer. Mobile collapsed pill and empty-draft
 * Craft Goal call requestOpenGoalDialog without a footer PiGoalButton, so the
 * dialog must not depend on ComposerFooter being mounted (#640).
 */
export const PiGoalDialogHost: React.FC = React.memo(() => {
  const isPiKernel = usePiKernel();
  const payload = usePiFeaturePluginsStore((state) => state.payload);
  const pendingGoalSeed = useInputStore((state) => state.pendingGoalDialogSeed);
  const sessionId = useSessionUIStore((state) => state.currentSessionId);
  const directory = useSessionUIStore((state) => state.currentSessionDirectory);
  const draftOpen = useSessionUIStore((state) => Boolean(state.newSessionDraft?.open));
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

  if (!isPiKernel) return null;

  const command = getPiGoalCommand(payload);

  return (
    <PiGoalDialog
      open={dialogOpen}
      onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) setDialogSeed('');
      }}
      sessionId={sessionId}
      directory={directory ?? undefined}
      command={command}
      draftOpen={draftOpen && !sessionId}
      initialObjective={dialogSeed}
    />
  );
});

PiGoalDialogHost.displayName = 'PiGoalDialogHost';
