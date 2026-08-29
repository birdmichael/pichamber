import React from 'react';

/**
 * Optional close/navigate signal for the mobile Work Status sheet.
 *
 * Desktop does not provide a listener. Mobile's overlay passes `onClose` so a
 * row that actually navigates (git, files, PR, subagent Open, pinned reveal,
 * MCP header) can drop the sheet instead of covering the destination.
 */
const WorkStatusNavigateContext = React.createContext<(() => void) | null>(null);

export const WorkStatusNavigateProvider = WorkStatusNavigateContext.Provider;

export const useWorkStatusNavigate = (): (() => void) | null => (
  React.useContext(WorkStatusNavigateContext)
);
