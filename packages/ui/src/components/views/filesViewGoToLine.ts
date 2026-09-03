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
}): boolean {
  if (!input.canEdit || input.textViewMode !== 'edit' || input.isMobile) {
    return false;
  }
  if (input.focus.inDialog || input.focus.typingOutsideEditor) {
    return false;
  }
  return input.focus.inEditor && input.focus.inEditorRoot;
}

/** Menu / palette invoke dispatches a synthetic keydown with no target. */
export function shouldOpenFilesGoToLineWithoutFocus(input: {
  canEdit: boolean;
  textViewMode: 'view' | 'edit';
  isMobile: boolean;
  hasEditor: boolean;
  eventTarget: EventTarget | null;
}): boolean {
  if (input.eventTarget != null) {
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
