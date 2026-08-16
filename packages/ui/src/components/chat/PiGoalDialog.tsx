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
import { useI18n } from '@/lib/i18n';
import { opencodeClient } from '@/lib/opencode/client';
import { canSubmitPiGoalObjective, resolvePiGoalSession, startPiGoalCommand } from '@/lib/piGoal';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { useSessionUIStore } from '@/sync/session-ui-store';

interface PiGoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  directory?: string;
  command: string;
  draftOpen?: boolean;
}

export function PiGoalDialog({
  open,
  onOpenChange,
  sessionId,
  directory,
  command,
  draftOpen = false,
}: PiGoalDialogProps) {
  const { t } = useI18n();
  const [objective, setObjective] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setObjective('');
    setError(null);
  }, [open]);

  const trimmed = objective.trim();
  const canSubmit = canSubmitPiGoalObjective(objective) && !busy;

  const submit = async () => {
    if (!canSubmitPiGoalObjective(objective)) return;
    setBusy(true);
    setError(null);
    try {
      const resolved = await resolvePiGoalSession({
        sessionID: sessionId,
        draftOpen,
        createSession: async () => {
          const created = await useSessionUIStore.getState().createSession(
            undefined,
            directory ?? null,
          );
          if (!created?.id) return null;
          useSessionUIStore.getState().setCurrentSession(created.id, created.directory ?? directory ?? null);
          return created;
        },
      });
      if (!resolved.ok) {
        setError(t('chat.piGoal.error.noSession'));
        return;
      }

      const result = await startPiGoalCommand({
        request: { sessionID: resolved.sessionID, command, objective },
        sendCommand: async (params) => {
          await opencodeClient.sendCommand({
            runtimeKey: getRuntimeKey(),
            id: params.id,
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
        setError(t('chat.piGoal.error.empty'));
        return;
      }
      if (result.reason === 'no-session') {
        setError(t('chat.piGoal.error.noSession'));
        return;
      }
      if (result.reason === 'missing-command') {
        setError(t('chat.piGoal.error.missingCommand', { command: result.command }));
        return;
      }
      setError(t('chat.piGoal.error.failed'));
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
          onChange={(event) => {
            setObjective(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canSubmit) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={t('chat.piGoal.dialog.objectivePlaceholder')}
          aria-label={t('chat.piGoal.dialog.objectiveLabel')}
          aria-invalid={Boolean(error)}
          disabled={busy}
          rows={4}
        />
        {error ? (
          <p role="alert" className="typography-meta text-[var(--status-error)]">
            {error}
          </p>
        ) : null}
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
