export type PreviewViewMode = 'preview' | 'edit';

export function isMarkdownFile(path: string): boolean {
  if (!path) return false;
  const ext = path.toLowerCase().split('.').pop();
  return ext === 'md' || ext === 'markdown';
}

/**
 * Markdown files open as a rendered preview unless this path or a stored
 * last-used mode already chose edit. The generic "open previewable files in
 * preview" setting must not flip markdown to source on first open.
 */
export function resolveMarkdownViewMode(input: {
  pathMode?: PreviewViewMode;
  storedMode?: string | null;
}): PreviewViewMode {
  if (input.pathMode === 'preview' || input.pathMode === 'edit') {
    return input.pathMode;
  }
  if (input.storedMode === 'preview' || input.storedMode === 'edit') {
    return input.storedMode;
  }
  return 'preview';
}
