import React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { opencodeClient } from '@/lib/opencode/client';
import { canSubmitPiGoalObjective, startPiGoalCommand } from '@/lib/piGoal';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { useConfigStore } from '@/stores/useConfigStore';

interface PiGoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  directory?: string;
  command: string;
}

export function PiGoalDialog({
  open,
  onOpenChange,
  sessionId,
  directory,
  command,
}: PiGoalDialogProps) {
  const { t } = useI18n();
  const [objective, setObjective] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setObjective('');
  }, [open]);

  const trimmed = objective.trim();
  const canSubmit = canSubmitPiGoalObjective(objective) && !busy;

  const submit = async () => {
    if (!canSubmitPiGoalObjective(objective)) return;
    setBusy(true);
    try {
      const { currentProviderId, currentModelId } = useConfigStore.getState();
      const result = await startPiGoalCommand({
        request: { sessionID: sessionId, command, objective },
        sendCommand: async (params) => {
          if (!currentProviderId || !currentModelId) {
            const error = new Error('No model is selected') as Error & { status?: number };
            error.status = 400;
            throw error;
          }
          await opencodeClient.sendCommand({
            runtimeKey: getRuntimeKey(),
            id: params.id,
            providerID: currentProviderId,
            modelID: currentModelId,
            command: params.command,
            arguments: params.arguments,
            directory: directory ?? null,
          });
        },
      });
      if (result.ok) {
        onOpenChange(false);
        return;
      }
      if (result.reason === 'empty') {
        toast.error(t('chat.piGoal.error.empty'));
        return;
      }
      if (result.reason === 'no-session') {
        toast.error(t('chat.piGoal.error.noSession'));
        return;
      }
      if (result.reason === 'missing-command') {
        toast.error(t('chat.piGoal.error.missingCommand', { command: result.command }));
        return;
      }
      toast.error(t('chat.piGoal.error.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-w-md gap-5" aria-label={t('chat.piGoal.dialog.aria')}>
        <DialogHeader>
          <DialogTitle>{t('chat.piGoal.dialog.title')}</DialogTitle>
          <DialogDescription>{t('chat.piGoal.dialog.objectiveLabel')}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          placeholder={t('chat.piGoal.dialog.objectivePlaceholder')}
          aria-label={t('chat.piGoal.dialog.objectiveLabel')}
          disabled={busy}
          rows={4}
        />
        <DialogFooter className="w-full sm:justify-end">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
              {t('chat.piGoal.dialog.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canSubmit || !trimmed}
              onClick={() => void submit()}
            >
              {t('chat.piGoal.dialog.submit')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
