import * as React from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { cn } from '@/lib/utils';
import { resolveUpdateAvailableBannerPortalTarget } from './openCodeUpdateBannerPortal';

const UPDATE_AVAILABLE_HOST_ID = 'pichamber-update-available-host';

/**
 * Same offset as sonner toasts. Sit below the titlebar so the pill does not
 * cover traffic lights or header icons (#296).
 */
const UPDATE_AVAILABLE_BANNER_TOP = 'calc(var(--oc-header-height, 3rem) + 12px)';

interface OpenCodeUpdateBannerProps {
  title: string;
  description?: string | null;
  dismissLabel: string;
  primaryLabel: string;
  onDismiss: () => void;
  onPrimary: () => void;
}

/**
 * React-controlled update pill. Not sonner. Dismiss/OK are real buttons;
 * hiding is parent state, not toast.dismiss(). Portaled to document.body so
 * the header column cannot paint over it.
 */
export const OpenCodeUpdateBanner: React.FC<OpenCodeUpdateBannerProps> = ({
  title,
  description,
  dismissLabel,
  primaryLabel,
  onDismiss,
  onPrimary,
}) => {
  const overlay = (
    <div
      id={UPDATE_AVAILABLE_HOST_ID}
      data-update-available-host=""
      className="pointer-events-none fixed inset-x-0 z-[80] flex justify-center"
      style={{ top: UPDATE_AVAILABLE_BANNER_TOP }}
    >
      <div
        role="status"
        data-update-available-banner=""
        className={cn(
          'app-region-no-drag pointer-events-auto flex max-w-[min(36rem,calc(100vw-2rem))] items-center gap-2 rounded-full',
          'border border-border/50 bg-[var(--surface-elevated)] px-3 py-1.5 text-foreground shadow-md',
        )}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Icon name="information" className="h-4 w-4 shrink-0 text-[var(--status-info)]" />
        <div className="min-w-0 flex-1">
          <p className="truncate typography-ui-label font-medium">{title}</p>
          {description ? (
            <p className="truncate typography-micro text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="app-region-no-drag pointer-events-auto normal-case"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={onDismiss}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {dismissLabel}
        </Button>
        <Button
          type="button"
          variant="default"
          size="xs"
          className="app-region-no-drag pointer-events-auto normal-case"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={onPrimary}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {primaryLabel}
        </Button>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return overlay;
  const target = resolveUpdateAvailableBannerPortalTarget(document);
  return target ? createPortal(overlay, target) : overlay;
};
