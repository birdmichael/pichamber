import React from 'react';

import { PiPlanBuildRow } from '@/components/chat/PiPlanBuildRow';
import { SimpleMarkdownRenderer } from '@/components/chat/MarkdownRenderer';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { toast } from '@/components/ui';
import { PreviewToggleButton } from '@/components/views/PreviewToggleButton';
import { usePiPlanChrome } from '@/hooks/usePiPlanChrome';
import { copyTextToClipboard } from '@/lib/clipboard';
import { useI18n } from '@/lib/i18n';
import { parseProjectPlanMarkdown } from '@/lib/openchamberConfig';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { normalizeContextPanelDirectoryKey, useUIStore } from '@/stores/useUIStore';
import { dispatchSessionPlanAction } from '@/sync/pi-session-plan-store';

export function PiSessionPlanView() {
  const { t } = useI18n();
  const chrome = usePiPlanChrome();
  const [mdViewMode, setMdViewMode] = React.useState<'preview' | 'edit'>('preview');
  const [copied, setCopied] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [discarding, setDiscarding] = React.useState(false);
  const copiedTimeoutRef = React.useRef<number | null>(null);
  const effectiveDirectory = useEffectiveDirectory();

  const content = chrome.plan?.planMarkdown ?? '';
  const title = chrome.plan?.title
    || (content.trim() ? parseProjectPlanMarkdown(content).title : '')
    || t('planView.title.default');

  React.useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current !== null) {
        window.clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  const closePlanSurface = React.useCallback(() => {
    const directory = effectiveDirectory ? normalizeContextPanelDirectoryKey(effectiveDirectory) : '';
    if (!directory) return;
    const panel = useUIStore.getState().contextPanelByDirectory[directory];
    const active = panel?.tabs.find((tab) => tab.id === panel.activeTabId);
    if (active?.mode === 'plan') {
      useUIStore.getState().closeContextPanel(directory);
    }
  }, [effectiveDirectory]);

  const discard = async () => {
    if (!chrome.sessionID) return;
    setDiscarding(true);
    try {
      const next = await dispatchSessionPlanAction(chrome.sessionID, 'exit');
      if (!next) {
        toast.error(t('chat.piPlan.discardFailed'));
        return;
      }
      setDiscardOpen(false);
      closePlanSurface();
    } finally {
      setDiscarding(false);
    }
  };

  if (!chrome.showViewPlan && !chrome.implementing) {
    return null;
  }

  return (
    <div className="relative flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden bg-background">
      <div className="flex min-w-0 items-center gap-2 border-b border-border/40 px-3 py-1.5 flex-shrink-0">
        <div className="min-w-0 flex-1">
          <div className="typography-ui-label font-medium truncate">{title}</div>
        </div>
        <div className="flex items-center gap-1">
          <PreviewToggleButton
            currentMode={mdViewMode}
            onToggle={() => setMdViewMode(mdViewMode === 'preview' ? 'edit' : 'preview')}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              const result = await copyTextToClipboard(content);
              if (!result.ok) return;
              setCopied(true);
              if (copiedTimeoutRef.current !== null) {
                window.clearTimeout(copiedTimeoutRef.current);
              }
              copiedTimeoutRef.current = window.setTimeout(() => setCopied(false), 1200);
            }}
            className="h-5 w-5 p-0"
            title={t('planView.actions.copyPlanContents')}
            aria-label={t('planView.actions.copyPlanContents')}
          >
            {copied ? (
              <Icon name="check" className="h-4 w-4 text-[color:var(--status-success)]" />
            ) : (
              <Icon name="clipboard" className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 min-w-0 relative">
        <ScrollableOverlay outerClassName="h-full min-w-0" className="h-full min-w-0">
          <div className="h-full overflow-auto p-3">
            {mdViewMode === 'preview' ? (
              <ErrorBoundary
                fallback={
                  <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2">
                    <div className="mb-1 font-medium text-destructive">{t('planView.error.previewUnavailable')}</div>
                    <div className="text-sm text-muted-foreground">
                      {t('planView.error.switchToEditMode')}
                    </div>
                  </div>
                }
              >
                <SimpleMarkdownRenderer content={content} className="typography-markdown-body" enableFileReferences={false} />
              </ErrorBoundary>
            ) : (
              <pre className="typography-markdown-body whitespace-pre-wrap break-words">{content}</pre>
            )}
          </div>
        </ScrollableOverlay>
      </div>

      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-border/40 px-3 py-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={chrome.busy || discarding || !chrome.sessionID}
          onClick={() => setDiscardOpen(true)}
        >
          {t('chat.piPlan.discard')}
        </Button>
        <PiPlanBuildRow />
      </div>

      <Dialog open={discardOpen} onOpenChange={(open) => { if (!discarding) setDiscardOpen(open); }}>
        <DialogContent showCloseButton={false} className="max-w-sm gap-5" aria-label={t('chat.piPlan.discardConfirmAria')}>
          <DialogHeader>
            <DialogTitle>{t('chat.piPlan.discardConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('chat.piPlan.discardConfirmDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="w-full sm:justify-end">
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={discarding} onClick={() => setDiscardOpen(false)}>
                {t('chat.piPlan.discardCancel')}
              </Button>
              <Button type="button" variant="destructive" size="sm" disabled={discarding} onClick={() => void discard()}>
                {t('chat.piPlan.discardConfirm')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
