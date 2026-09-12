import React, { lazy } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { markDialogLayerMounted } from '@/components/ui/dialog-open-layer';
import { notifySettingsEscapeForm, shouldBlockSettingsDismiss } from '@/lib/settings-dismiss';
import { focusDesktopWindow } from '@/lib/desktop';
import { importWithChunkRecovery } from '@/lib/chunkLoadRecovery';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

// SettingsView pulls CodeMirror / vim / theme tooling; load it only when open.
// Keep one shared promise so autocomplete / idle prefetch and Suspense share the same chunk load.
let settingsViewImportPromise: Promise<{ default: typeof import('./SettingsView').SettingsView }> | null = null;

// eslint-disable-next-line react-refresh/only-export-components -- intentional prefetch API for dialog open
export function prefetchSettingsView(): Promise<{ default: typeof import('./SettingsView').SettingsView }> {
  if (!settingsViewImportPromise) {
    settingsViewImportPromise = importWithChunkRecovery(() =>
      import('./SettingsView').then((m) => ({ default: m.SettingsView })),
    );
  }
  return settingsViewImportPromise;
}

const SettingsView = lazy(() => prefetchSettingsView());

/** Keep the dialog useful while the SettingsView chunk is being fetched. */
const SettingsWindowLoading: React.FC<{ label: string }> = ({ label }) => (
  <div data-settings-view="true" className="flex h-full min-h-0 flex-1 bg-[var(--surface-background)] text-[var(--surface-foreground)]" aria-busy="true" aria-label={label}>
    <div className="flex w-64 shrink-0 flex-col gap-3 border-r border-border bg-sidebar p-4">
      <div className="h-8 animate-pulse rounded-md bg-muted" />
      <div className="flex flex-col gap-2 pt-2">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="h-8 animate-pulse rounded-md bg-muted/70" />
        ))}
      </div>
    </div>
    <div className="flex min-w-0 flex-1 items-center justify-center bg-background">
      <div className="flex items-center gap-2 typography-ui text-muted-foreground">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
        <span>{label}</span>
      </div>
    </div>
  </div>
);

const SettingsWindowError: React.FC<{ onClose: () => void; title: string; description: string; closeLabel: string }> = ({ onClose, title, description, closeLabel }) => (
  <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-background p-6">
    <div className="max-w-md space-y-3 text-center">
      <h2 className="typography-ui-label text-foreground">{title}</h2>
      <p className="typography-ui text-muted-foreground">{description}</p>
      <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 typography-ui text-foreground hover:bg-interactive-hover">{closeLabel}</button>
    </div>
  </div>
);

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

  // Warm the SettingsView chunk after startup idle so first open (gear or # → Add snippet)
  // paints the real form instead of sitting on a ~2s dead click / long skeleton.
  React.useEffect(() => {
    const warm = () => {
      void prefetchSettingsView();
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timeout = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(timeout);
  }, []);

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
          // Base UI still applies the close unless cancel() is called, which
          // leaves ending-style overlays that eat the next gear click (#378).
          eventDetails?.cancel?.();
          if (!next && eventDetails?.reason === 'escape-key') {
            notifySettingsEscapeForm();
          }
          return;
        }
        onOpenChange(next);
        if (!next) {
          void focusDesktopWindow();
        }
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
            data-settings-dialog="true"
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
                <React.Suspense fallback={<SettingsWindowLoading label={t("common.loading")} />}>
                  <ErrorBoundary
                    fallback={<SettingsWindowError onClose={() => onOpenChange(false)} title={t("errorBoundary.title")} description={t("errorBoundary.description")} closeLabel={t("settings.view.actions.closeSettings")} />}
                  >
                    <SettingsView onClose={() => onOpenChange(false)} isWindowed />
                  </ErrorBoundary>
                </React.Suspense>
              </div>
            ) : null}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
