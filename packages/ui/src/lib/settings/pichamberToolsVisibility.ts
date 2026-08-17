/**
 * Settings → Pichamber Tools is a Desktop/web host surface.
 * VS Code has no in-app browser rail, so the card stays hidden there.
 */
export function shouldShowPichamberToolsSettings(ctx: { isVSCode: boolean }): boolean {
  return !ctx.isVSCode;
}

/**
 * Agent-control / orchestration is a host tool on Desktop Pi and leftover
 * OpenCode. VS Code has no host tool injection, so the row stays hidden.
 */
export function shouldShowAgentControlToolSettings(ctx: { isVSCode?: boolean } = {}): boolean {
  return !ctx.isVSCode;
}
