/**
 * Settings → Pichamber Tools is a Desktop/web host surface.
 * VS Code has no in-app browser rail, so the card stays hidden there.
 */
export function shouldShowPichamberToolsSettings(ctx: { isVSCode: boolean }): boolean {
  return !ctx.isVSCode;
}

/**
 * Agent-control / orchestration stays leftover-OpenCode-only until #186.
 * Pi Desktop shows only the Web tool row on this card.
 */
export function shouldShowAgentControlToolSettings(ctx: { isPiKernel: boolean }): boolean {
  return !ctx.isPiKernel;
}
