export type FilesGoToLineFocus = {
  inDialog: boolean;
  inEditor: boolean;
  inEditorRoot: boolean;
  typingOutsideEditor: boolean;
};

const TYPING_TARGET_SELECTOR = 'input, textarea, [contenteditable="true"], [role="textbox"]';

function eventTargetToElement(target: EventTarget | null): Element | null {
  if (!target || typeof target !== 'object') {
    return null;
  }
  if ('closest' in target && typeof (target as Element).closest === 'function') {
    return target as Element;
  }
  const parent = 'parentElement' in target
    ? (target as { parentElement: Element | null }).parentElement
    : null;
  return parent;
}

export function resolveFilesGoToLineFocus(
  target: EventTarget | null,
  editorRoot: Node | null,
): FilesGoToLineFocus {
  const element = eventTargetToElement(target);
  if (!element || !editorRoot) {
    return {
      inDialog: false,
      inEditor: false,
      inEditorRoot: false,
      typingOutsideEditor: false,
    };
  }

  const inEditor = Boolean(element.closest('.cm-editor'));
  const typing = Boolean(element.closest(TYPING_TARGET_SELECTOR));
  return {
    inDialog: Boolean(element.closest('[role="dialog"]')),
    inEditor,
    inEditorRoot: editorRoot.contains(element),
    typingOutsideEditor: typing && !inEditor,
  };
}

export function shouldOpenFilesGoToLine(input: {
  canEdit: boolean;
  textViewMode: 'view' | 'edit';
  isMobile: boolean;
  focus: FilesGoToLineFocus;
  /** Live CodeMirror for this Files edit session (editor-only sidebar included). */
  hasEditor?: boolean;
}): boolean {
  if (!input.canEdit || input.textViewMode !== 'edit' || input.isMobile) {
    return false;
  }
  if (input.focus.inDialog || input.focus.typingOutsideEditor) {
    return false;
  }
  // Composer is also a .cm-editor — never treat it as the Files editor.
  if (input.focus.inEditor && !input.focus.inEditorRoot) {
    return false;
  }
  if (input.focus.inEditor && input.focus.inEditorRoot) {
    return true;
  }
  // Linux Alt can move focus to the menu bar before Alt+G is delivered, so
  // event/active targets look "outside" even though Files edit is live. Match
  // find_in_file: open when this session has an editor and focus is not typing
  // elsewhere.
  return Boolean(input.hasEditor);
}

/**
 * Menu/palette `shortcutRegistry.invoke` builds an undelivered KeyboardEvent.
 * Chromium keeps `target === null`; some engines may leave a non-null placeholder.
 * `isTrusted === false` is the reliable signal; null/non-Node target is the fallback.
 */
export function isUndeliveredShortcutEventTarget(target: EventTarget | null): boolean {
  if (target == null) return true;
  if (typeof Node !== 'undefined' && target instanceof Node) return false;
  return true;
}

/** Menu / palette invoke — not a trusted DOM keydown in the Files editor. */
export function shouldOpenFilesGoToLineWithoutFocus(input: {
  canEdit: boolean;
  textViewMode: 'view' | 'edit';
  isMobile: boolean;
  hasEditor: boolean;
  eventTarget: EventTarget | null;
  /** Synthetic invoke is never trusted; real Alt+G is trusted. */
  isTrusted?: boolean;
}): boolean {
  if (input.isTrusted === true) {
    return false;
  }
  const undelivered = input.isTrusted === false
    || isUndeliveredShortcutEventTarget(input.eventTarget);
  if (!undelivered) {
    return false;
  }
  return input.canEdit && input.textViewMode === 'edit' && !input.isMobile && input.hasEditor;
}

export function consumeGoToLineSubmitKey(event: {
  key: string;
  preventDefault: () => void;
  stopPropagation: () => void;
  stopImmediatePropagation?: () => void;
}): boolean {
  if (event.key !== 'Enter') {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  return true;
}
