/**
 * Outside-dismiss for Work Status overlays (Desktop overlay card and the
 * mobile session-metadata sheet).
 *
 * `WorkStatusSectionsDialog` (and the Goal dialog) portal to document.body, so
 * a pointerdown-capture closer keyed on the panel node would treat a tap in
 * the dialog as "outside" and close the sheet under it.
 */
export const isWorkStatusDismissExemptTarget = (
  target: EventTarget | null,
  options?: { sectionsDialogOpen?: boolean },
): boolean => {
  if (options?.sectionsDialogOpen) return true;
  const element = target as { closest?: (selector: string) => Element | null } | null;
  if (typeof element?.closest !== 'function') return false;
  return Boolean(
    element.closest('[data-slot="dialog-content"]')
    || element.closest('[data-slot="dialog-overlay"]')
    || element.closest('[data-work-status-toggle]'),
  );
};

export const shouldCloseWorkStatusSheetOnNavigate = ({
  sessionIdWhenOpened,
  currentSessionId,
  panelWasOpen,
  panelIsOpen,
}: {
  sessionIdWhenOpened: string | null;
  currentSessionId: string | null;
  panelWasOpen: boolean;
  panelIsOpen: boolean;
}): boolean => (
  currentSessionId !== sessionIdWhenOpened || (!panelWasOpen && panelIsOpen)
);
