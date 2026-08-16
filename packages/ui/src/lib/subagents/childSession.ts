export type OpenSubagentChildSessionInput = {
  sessionID?: string | null;
  directory?: string | null;
  label: string;
  readOnly: boolean;
  isMobile: boolean;
  isVSCode: boolean;
  isEmbedded: boolean;
  setCurrentSession: (sessionID: string, directory: string) => void;
  openContextPanelTab: (
    directory: string,
    options: {
      mode: 'chat';
      dedupeKey: string;
      label: string;
      readOnly?: boolean;
    },
  ) => void;
};

export const canOpenSubagentChildSession = (sessionID?: string | null, directory?: string | null): boolean => (
  Boolean(sessionID?.trim() && directory?.trim())
);

export const openSubagentChildSession = (input: OpenSubagentChildSessionInput): boolean => {
  const sessionID = input.sessionID?.trim() || '';
  const directory = input.directory?.trim() || '';
  if (!canOpenSubagentChildSession(sessionID, directory)) {
    return false;
  }
  if (input.isEmbedded || input.isMobile || input.isVSCode) {
    input.setCurrentSession(sessionID, directory);
    return true;
  }
  input.openContextPanelTab(directory, {
    mode: 'chat',
    dedupeKey: `session:${sessionID}`,
    label: input.label,
    readOnly: input.readOnly,
  });
  return true;
};
