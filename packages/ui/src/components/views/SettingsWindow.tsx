import React from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { markDialogLayerMounted } from '@/components/ui/dialog-open-layer';
import { notifySettingsEscapeForm, shouldBlockSettingsDismiss } from '@/lib/settings-dismiss';
import { SettingsView } from './SettingsView';

interface SettingsWindowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Settings rendered as a centered window with blurred backdrop.
 * Used for desktop and web (non-mobile) environments.
 */
export const SettingsWindow: React.FC<SettingsWindowProps> = ({ open, onOpenChange }) => {
  const { t } = useI18n();
  const descriptionId = React.useId();

  React.useLayoutEffect(() => {
    if (!open) {
      return;
    }
    return markDialogLayerMounted();
  }, [open]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, eventDetails) => {
        if (shouldBlockSettingsDismiss(next, eventDetails)) {
          if (!next && eventDetails?.reason === 'escape-key') {
            notifySettingsEscapeForm();
          }
          return;
        }
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          data-slot="dialog-overlay"
          className={cn(
            'oc-glass-backdrop fixed inset-0 z-50 bg-black/25 dark:bg-black/40',
            'transition-opacity duration-150 ease-out',
            'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
            // Esc / close must not leave a leftover backdrop that eats the
            // next sidebar gear or session-row press.
            !open && 'pointer-events-none',
            'data-[ending-style]:pointer-events-none',
          )}
        />
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <Dialog.Popup
            aria-describedby={descriptionId}
            className={cn(
              'relative flex min-h-0 flex-col pointer-events-auto',
              'w-[90vw] max-w-[1200px] h-[85vh] max-h-[900px]',
              'rounded-xl border shadow-none overflow-hidden origin-center',
              'bg-[var(--surface-background)] text-[var(--surface-foreground)]',
              'transition-all duration-150 ease-out',
              'data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.98]',
              'data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.98]',
              !open && 'pointer-events-none',
              'data-[ending-style]:pointer-events-none',
              // Dim this window when a nested dialog (e.g. "Add a device") opens
              // on top of it, mirroring how the page behind a dialog is dimmed.
              'data-[nested-dialog-open]:brightness-[0.55] dark:data-[nested-dialog-open]:brightness-[0.4]',
            )}
          >
            <Dialog.Description id={descriptionId} className="sr-only">
              {t('settings.window.description')}
            </Dialog.Description>
            {open ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <SettingsView onClose={() => onOpenChange(false)} isWindowed />
              </div>
            ) : null}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
