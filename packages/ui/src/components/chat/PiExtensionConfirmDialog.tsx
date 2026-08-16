import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import {
  cancelPiExtensionUi,
  isPiExtensionUiNotFoundError,
  replyPiExtensionUi,
  type PiExtensionUiPrompt,
} from '@/sync/pi-extension-ui';

export function PiExtensionConfirmDialog({ prompt }: { prompt: PiExtensionUiPrompt | null }) {
  const { t } = useI18n();
  const [busy, setBusy] = React.useState(false);

  const settle = React.useCallback(async (confirmed: boolean) => {
    if (!prompt) return;
    setBusy(true);
    try {
      if (confirmed) {
        await replyPiExtensionUi(prompt.sessionID, prompt.id, true);
      } else {
        await cancelPiExtensionUi(prompt.sessionID, prompt.id);
      }
    } catch (error) {
      if (isPiExtensionUiNotFoundError(error)) {
        toast.info(t('chat.piExtensionUi.noLongerPending'));
      } else {
        toast.error(t('chat.piExtensionUi.submitFailed'), {
          description: t('chat.piExtensionUi.tryAgain'),
        });
      }
    } finally {
      setBusy(false);
    }
  }, [prompt, t]);

  return (
    <Dialog open={Boolean(prompt)} onOpenChange={(open) => { if (!open && prompt?.status === 'pending' && !busy) void settle(false); }}>
      <DialogContent showCloseButton={false} className="max-w-sm gap-5" aria-label={t('chat.piExtensionUi.confirmAria')}>
        <DialogHeader>
          <DialogTitle>{prompt?.title || t('chat.piExtensionUi.confirm')}</DialogTitle>
          {prompt?.message ? <DialogDescription>{prompt.message}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter className="w-full sm:justify-end">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void settle(false)}>
              {t('chat.piExtensionUi.cancel')}
            </Button>
            <Button type="button" size="sm" disabled={busy} onClick={() => void settle(true)}>
              {t('chat.piExtensionUi.confirm')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
