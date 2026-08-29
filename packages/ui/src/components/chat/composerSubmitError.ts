type ComposerSubmitErrorKind = 'runtime-changed' | 'unknown-command' | 'command-failed' | 'raw';

export const classifyComposerSubmitError = (error: unknown): {
  kind: ComposerSubmitErrorKind;
  raw: string;
} => {
  const raw = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';
  const lower = raw.toLowerCase();
  if (lower.includes('runtime changed')) {
    return { kind: 'runtime-changed', raw };
  }
  if (
    lower.includes('unknown command')
    || (lower.includes('session.command failed') && lower.includes('404'))
  ) {
    return { kind: 'unknown-command', raw };
  }
  if (lower.includes('session.command failed')) {
    return { kind: 'command-failed', raw };
  }
  return { kind: 'raw', raw };
};
