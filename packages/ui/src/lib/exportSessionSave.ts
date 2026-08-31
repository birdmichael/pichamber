export type SessionTextExportFilter = {
  name: string;
  extensions: string[];
};

export type SessionTextExportResult =
  | { status: 'saved'; path: string }
  | { status: 'canceled' }
  | { status: 'downloaded' };

export type SessionTextExportDeps = {
  canSaveDesktop: () => boolean;
  saveDesktop: (input: {
    filename: string;
    content: string;
    filters?: SessionTextExportFilter[];
  }) => Promise<string | null>;
  download: (content: string, filename: string, mime: string) => void;
};

export async function exportSessionTextFile(
  input: {
    content: string;
    filename: string;
    mime: string;
    filters?: SessionTextExportFilter[];
  },
  deps: SessionTextExportDeps,
): Promise<SessionTextExportResult> {
  if (deps.canSaveDesktop()) {
    const savedPath = await deps.saveDesktop({
      filename: input.filename,
      content: input.content,
      filters: input.filters,
    });
    if (typeof savedPath === 'string' && savedPath.trim().length > 0) {
      return { status: 'saved', path: savedPath };
    }
    return { status: 'canceled' };
  }

  deps.download(input.content, input.filename, input.mime);
  return { status: 'downloaded' };
}

export function shouldToastSessionTextExport(result: SessionTextExportResult): boolean {
  return result.status !== 'canceled';
}

export function exportFiltersForFormat(format: 'jsonl' | 'html'): SessionTextExportFilter[] {
  return format === 'html'
    ? [{ name: 'HTML', extensions: ['html'] }]
    : [{ name: 'JSONL', extensions: ['jsonl'] }];
}
