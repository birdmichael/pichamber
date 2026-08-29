import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { ScrollShadow } from '@/components/ui/ScrollShadow';
import { useI18n } from '@/lib/i18n';

import { WorkStatusBody } from './WorkStatusBody';
import { WorkStatusSectionsDialog } from './WorkStatusSectionsDialog';
import { WorkStatusPresenceProvider } from './presence';
import { getWorkStatusPanelPresentation } from './sections';
import { useWorkStatusSectionVisibility } from './useWorkStatusSectionVisibility';
import { WorkStatusNavigateProvider } from './workStatusNavigate';

type Props = {
  sessionId: string | null;
  directory: string | null;
  repositoryEnabled?: boolean;
  /** Desktop collapse: drop the scroller after the card finishes hiding. */
  contentMounted?: boolean;
  visible?: boolean;
  restoreScroll?: (node: HTMLElement | null) => void;
  onScroll?: (event: React.UIEvent<HTMLElement>) => void;
  onPresenceChange?: (count: number) => void;
  onSectionsDialogOpenChange?: (open: boolean) => void;
  /** Mobile overlay: close the sheet when a row navigates. */
  onNavigate?: () => void;
};

/**
 * Shared chrome: title row, equalizer, sections dialog, empty-state, presence.
 *
 * The 300px `WorkStatusPanel` card is Desktop-only. Mobile renders this inside
 * `MobileWorkStatusHost` and must not import that card.
 */
export const WorkStatusContents: React.FC<Props> = ({
  sessionId,
  directory,
  repositoryEnabled = true,
  contentMounted = true,
  visible = true,
  restoreScroll,
  onScroll,
  onPresenceChange,
  onSectionsDialogOpenChange,
  onNavigate,
}) => {
  const { t } = useI18n();
  const { allSectionsHidden } = useWorkStatusSectionVisibility();
  const [sectionsDialogOpen, setSectionsDialogOpen] = React.useState(false);
  const [renderedSections, setRenderedSections] = React.useState(1);

  const handlePresenceChange = React.useCallback((count: number) => {
    setRenderedSections(count);
    onPresenceChange?.(count);
  }, [onPresenceChange]);

  const handleDialogOpenChange = React.useCallback((open: boolean) => {
    setSectionsDialogOpen(open);
    onSectionsDialogOpenChange?.(open);
  }, [onSectionsDialogOpenChange]);

  const { showEmptyState } = getWorkStatusPanelPresentation({
    visible,
    contentMounted,
    renderedSections,
    allSectionsHidden,
  });

  return (
    <WorkStatusNavigateProvider value={onNavigate ?? null}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex h-7 shrink-0 items-center px-3 pr-8">
          <h2 className="text-xs font-normal text-muted-foreground">{t('chat.workStatus.ariaLabel')}</h2>
        </div>
        <button
          type="button"
          data-work-status-equalizer="true"
          aria-label={t('chat.workStatus.sections.open')}
          onClick={() => handleDialogOpenChange(true)}
          className="absolute right-2 top-1.5 z-10 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon name="equalizer-2" className="size-4" />
        </button>

        {contentMounted ? (
          <WorkStatusPresenceProvider onChange={handlePresenceChange}>
            <ScrollShadow
              ref={restoreScroll}
              onScroll={onScroll}
              size={24}
              className="oc-hide-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2"
            >
              <WorkStatusBody
                sessionId={sessionId}
                directory={directory}
                repositoryEnabled={repositoryEnabled}
              />
            </ScrollShadow>
          </WorkStatusPresenceProvider>
        ) : null}

        {showEmptyState ? (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <span className="text-sm text-muted-foreground">{t('chat.workStatus.sections.allHidden')}</span>
            <Button
              variant="link"
              size="xs"
              onClick={() => handleDialogOpenChange(true)}
              className="mt-2 normal-case text-muted-foreground hover:text-foreground"
            >
              {t('chat.workStatus.sections.open')}
            </Button>
          </div>
        ) : null}

        <WorkStatusSectionsDialog open={sectionsDialogOpen} onOpenChange={handleDialogOpenChange} />
      </div>
    </WorkStatusNavigateProvider>
  );
};
