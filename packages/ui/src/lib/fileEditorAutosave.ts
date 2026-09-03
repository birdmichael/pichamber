export type FileEditorAutosaveGate = {
  autoSaveEnabled: boolean;
  isDirty: boolean;
  canWrite: boolean;
  isSaving: boolean;
  fileLoading: boolean;
  selectedFilePath: string | null | undefined;
  loadedFilePath: string | null;
  /** True when the selected file must never be written as text (binary / non-editable). */
  isNonEditableBinary: boolean;
};

/**
 * Whether the FilesView autosave effect should schedule a debounced save.
 * Incomplete loads and binary files must never trigger a write.
 */
export function shouldScheduleFileAutosave(gate: FileEditorAutosaveGate): boolean {
  if (!gate.autoSaveEnabled || !gate.isDirty || !gate.canWrite || gate.isSaving) {
    return false;
  }
  if (gate.fileLoading || gate.isNonEditableBinary) {
    return false;
  }
  if (!gate.selectedFilePath || gate.loadedFilePath !== gate.selectedFilePath) {
    return false;
  }
  return true;
}

export type FileEditorSaveDraftGate = {
  selectedFilePath: string | null | undefined;
  loadedFilePath: string | null;
  fileLoading: boolean;
  isDirty: boolean;
  draftContent: string;
  fileContent: string;
  isNonEditableBinary: boolean;
};

/**
 * Whether saveDraft may proceed.
 * - Clean drafts return true ("nothing to save" is success) so callers like the
 *   unsaved-changes dialog and Ctrl+S do not treat a no-op as failure.
 * - Incomplete loads and binary targets return false (refused).
 */
export function shouldAllowFileDraftSave(gate: FileEditorSaveDraftGate): boolean {
  if (!gate.selectedFilePath) {
    return false;
  }
  if (!gate.isDirty) {
    return true;
  }
  if (gate.fileLoading || gate.loadedFilePath !== gate.selectedFilePath || gate.isNonEditableBinary) {
    return false;
  }
  if (gate.draftContent === '' && gate.fileContent !== '' && gate.loadedFilePath !== gate.selectedFilePath) {
    return false;
  }
  return true;
}

export type FileEditorSaveChromeState = 'idle' | 'dirty' | 'saving' | 'saved';

/**
 * Visible save-state chrome for the Files editor.
 * Dirty is immediate on first keystroke; Saving/Saved follow the in-flight write.
 * Autosave itself stays optional — this only describes what the UI must show.
 */
export function getFileEditorSaveChromeState(input: {
  isDirty: boolean;
  isSaving: boolean;
  autoSaveStatus: 'idle' | 'saved';
}): FileEditorSaveChromeState {
  if (input.isSaving) {
    return 'saving';
  }
  if (input.isDirty) {
    return 'dirty';
  }
  if (input.autoSaveStatus === 'saved') {
    return 'saved';
  }
  return 'idle';
}

/** Active tab / editor-only filename with a dirty bullet when the buffer is unsaved. */
export function formatFileEditorTabName(fileName: string, isDirty: boolean): string {
  return isDirty ? `${fileName} •` : fileName;
}

/**
 * Hover-only floating controls hide dirty/Saving/Saved. Persist that chrome on
 * desktop unless the expanded (always-visible) editor toolbar already shows it.
 */
export function shouldShowPersistentFileEditorSaveChrome(input: {
  isMobile: boolean;
  expandedEditorToolbar: boolean;
}): boolean {
  return !input.isMobile && !input.expandedEditorToolbar;
}
