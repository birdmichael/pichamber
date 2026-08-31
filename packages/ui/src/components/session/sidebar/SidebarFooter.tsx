import React from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from "@/components/icon/Icon";
import { useI18n } from '@/lib/i18n';
import { isPrimaryTitlebarPointer } from '@/components/layout/titlebarIconActivate';
import { markSettingsOpenedFromTrigger } from '@/lib/settings-dismiss';

type Props = {
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onOpenAbout: () => void;
  onOpenUpdate: () => void;
  showRuntimeButtons?: boolean;
  showUpdateButton?: boolean;
  showRefreshButton?: boolean;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  refreshInFlight?: boolean;
  refreshAriaLabel?: string;
  refreshTooltip?: string;
};

const footerButtonClassName = 'app-region-no-drag inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-interactive-hover/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50';

export function SidebarFooter({
  onOpenSettings,
  onOpenShortcuts,
  onOpenAbout,
  onOpenUpdate,
  showRuntimeButtons = true,
  showUpdateButton = true,
  showRefreshButton = false,
  onRefresh,
  refreshDisabled = false,
  refreshInFlight = false,
  refreshAriaLabel,
  refreshTooltip,
}: Props): React.ReactNode {
  const { t } = useI18n();
  const [settingsTooltipOpen, setSettingsTooltipOpen] = React.useState(false);

  // Close the hover tooltip on press so it cannot eat the activating click.
  // Do NOT open Settings on pointerdown: that mounts the dialog backdrop before
  // mouseup, and Base UI treats the same gesture as an outside-press that
  // closes Settings again (three-click bug #378). Open on click instead.
  const handleSettingsPointerDown = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!isPrimaryTitlebarPointer(event.button)) {
      return;
    }
    setSettingsTooltipOpen(false);
  }, []);

  const handleSettingsClick = React.useCallback(() => {
    markSettingsOpenedFromTrigger();
    onOpenSettings();
  }, [onOpenSettings]);

  if (!showRuntimeButtons && !showUpdateButton) {
    return null;
  }

  return (
    <div className="flex shrink-0 items-center justify-start gap-1 px-2.5 py-2">
      {showRuntimeButtons ? (
        <>
          <Tooltip open={settingsTooltipOpen} onOpenChange={setSettingsTooltipOpen}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onPointerDown={handleSettingsPointerDown}
                onClick={handleSettingsClick}
                className={footerButtonClassName}
                aria-label={t('sessions.sidebar.footer.actions.settings')}
              >
                <Icon name="settings-3" className="h-4.5 w-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}><p>{t('sessions.sidebar.footer.actions.settings')}</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={onOpenShortcuts} className={footerButtonClassName} aria-label={t('sessions.sidebar.footer.actions.shortcuts')}>
                <Icon name="command" className="h-4.5 w-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}><p>{t('sessions.sidebar.footer.actions.shortcuts')}</p></TooltipContent>
          </Tooltip>
          {showRefreshButton ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={refreshDisabled}
                  className={`${footerButtonClassName} disabled:pointer-events-none disabled:opacity-50`}
                  aria-label={refreshAriaLabel ?? t('sessions.sidebar.footer.refresh.aria')}
                >
                  <Icon
                    name={refreshInFlight ? 'loader-4' : 'refresh'}
                    className={`h-4.5 w-4.5${refreshInFlight ? ' animate-spin' : ''}`}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                <p>{refreshTooltip ?? t('sessions.sidebar.footer.refresh.tooltip')}</p>
              </TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={onOpenAbout} className={footerButtonClassName} aria-label={t('sessions.sidebar.footer.actions.aboutOpenChamber')}>
                <Icon name="information" className="h-4.5 w-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}><p>{t('sessions.sidebar.footer.actions.aboutOpenChamber')}</p></TooltipContent>
          </Tooltip>
        </>
      ) : null}
      {showUpdateButton ? (
        <Button
          type="button"
          variant="default"
          size="xs"
          className="ml-auto border-[var(--status-info-border)] bg-[var(--status-info-background)] text-[var(--status-info)] hover:bg-[var(--status-info-background)]/80 hover:text-[var(--status-info)] dark:border-[var(--status-info-border)] dark:bg-[var(--status-info-background)] dark:hover:bg-[var(--status-info-background)]/80"
          onClick={onOpenUpdate}
        >
          {t('sessions.sidebar.footer.actions.update')}
        </Button>
      ) : null}
    </div>
  );
}
