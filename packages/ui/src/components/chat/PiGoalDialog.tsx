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
import { usePiPlanChrome } from '@/hooks/usePiPlanChrome';
import {
  canSubmitPiGoalObjective,
  isPiGoalBlockedByPlan,
  readPiGoalRouteSessionID,
  resolvePiGoalDirectory,
  resolvePiGoalTargetSession,
  submitPiGoalFromDialog,
} from '@/lib/piGoal';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { readLastActiveSession } from '@/sync/last-session-cache';
import { applyPlanToggleSelect } from '@/sync/pi-session-plan';
import { dispatchSessionPlanAction } from '@/sync/pi-session-plan-store';
import { useSessionUIStore } from '@/sync/session-ui-store';

interface PiGoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  directory?: string;
  command: string;
  draftOpen?: boolean;
  initialObjective?: string;
}

export function PiGoalDialog({
  open,
  onOpenChange,
  sessionId,
  directory,
  command,
  draftOpen = false,
  initialObjective = '',
}: PiGoalDialogProps) {
  const { t } = useI18n();
  const chrome = usePiPlanChrome();
  const draftPlanSelected = useSessionUIStore((state) => state.newSessionDraft?.planSelected === true);
  const planBlocked = isPiGoalBlockedByPlan({
    draftPlanSelected: chrome.footerPlanSelected || draftPlanSelected,
    planStatus: chrome.status,
  });
  const [objective, setObjective] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const mintedRef = React.useRef<{ sessionID: string; directory: string | null } | null>(null);
  const openedTargetRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      mintedRef.current = null;
      openedTargetRef.current = null;
      setObjective('');
      setError(null);
      return;
    }
    setObjective(initialObjective);
    const store = useSessionUIStore.getState();
    const lastActive = readLastActiveSession(getRuntimeKey());
    openedTargetRef.current = resolvePiGoalTargetSession({
      sessionID: sessionId,
      currentSessionID: store.currentSessionId,
      routeSessionID: typeof window === 'undefined' ? '' : readPiGoalRouteSessionID(window.location.search),
      lastActiveSessionID: lastActive?.sessionId,
    }) || null;
  }, [open, sessionId, initialObjective]);

  React.useEffect(() => {
    if (!open) return;
    if (planBlocked) setError(t('chat.piGoal.error.planActive'));
  }, [open, planBlocked, t]);

  const trimmed = objective.trim();
  const canSubmit = canSubmitPiGoalObjective(objective) && !busy && !planBlocked;

  const exitPlan = async () => {
    if (!planBlocked || busy) return;
    setBusy(true);
    try {
      const result = await applyPlanToggleSelect({
        sessionID: chrome.sessionID,
        draftOpen: chrome.draftOpen,
        status: chrome.status,
        side: 'agent',
        setDraftPlanSelected: useSessionUIStore.getState().setDraftPlanSelected,
        dispatchSessionPlanAction,
      });
      if (result.kind === 'session-action-failed') {
        setError(t('chat.piPlan.actionFailed'));
        return;
      }
      setError(null);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (planBlocked) {
      setError(t('chat.piGoal.error.planActive'));
      return;
    }
    if (!canSubmitPiGoalObjective(objective)) return;
    setBusy(true);
    setError(null);
    try {
      const store = useSessionUIStore.getState();
      const lastActive = readLastActiveSession(getRuntimeKey());
      const routeSessionID = typeof window === 'undefined' ? '' : readPiGoalRouteSessionID(window.location.search);
      const liveCurrentID = store.currentSessionId;
      const targetSessionID = resolvePiGoalTargetSession({
        sessionID: sessionId || mintedRef.current?.sessionID || openedTargetRef.current,
        currentSessionID: liveCurrentID,
        routeSessionID,
        lastActiveSessionID: lastActive?.sessionId,
      });
      const sessionDirectory = targetSessionID ? store.getDirectoryForSession(targetSessionID) : null;
      const result = await submitPiGoalFromDialog({
        sessionID: sessionId || mintedRef.current?.sessionID || openedTargetRef.current,
        currentSessionID: liveCurrentID,
        routeSessionID,
        lastActiveSessionID: lastActive?.sessionId,
        draftOpen: draftOpen && !mintedRef.current && !targetSessionID,
        draftPlanSelected: chrome.footerPlanSelected || draftPlanSelected,
        planStatus: chrome.status,
        directory: mintedRef.current?.directory ?? resolvePiGoalDirectory({
          sessionDirectory,
          lastActiveDirectory: lastActive?.directory,
          composerDirectory: directory,
        }),
        command,
        objective,
        createSession: async () => {
          const created = await useSessionUIStore.getState().createSession(
            undefined,
            directory ?? null,
            null,
            undefined,
            { activate: false },
          );
          if (!created?.id) return null;
          return created;
        },
        sendCommand: async (params) => {
          await opencodeClient.sendCommand({
            runtimeKey: getRuntimeKey(),
            id: params.id,
            command: params.command,
            arguments: params.arguments,
            directory: params.directory,
          });
        },
      });
      if (result.ok) {
        mintedRef.current = null;
        useSessionUIStore.getState().setCurrentSession(result.sessionID, result.directory);
        onOpenChange(false);
        return;
      }
      if (result.sessionID) {
        mintedRef.current = {
          sessionID: result.sessionID,
          directory: result.directory ?? null,
        };
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
        setError(t('chat.piGoal.error.missingCommand', { command: result.command ?? command }));
        return;
      }
      if (result.reason === 'plan-mutex') {
        setError(t('chat.piGoal.error.planActive'));
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
            if (error && !planBlocked) setError(null);
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
            {planBlocked ? (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void exitPlan()}>
                {t('chat.piGoal.dialog.exitPlan')}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={!canSubmit || !trimmed}
              aria-disabled={!canSubmit || !trimmed}
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
