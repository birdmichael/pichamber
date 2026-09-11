/** Home / root path labels that look like junk in "Quick notes - {project}". */
export function isJunkNotesProjectLabel(label: string | null | undefined): boolean {
  const trimmed = label?.trim() ?? '';
  if (!trimmed) return true;
  return trimmed === '~' || trimmed === '/' || trimmed === '~/';
}
