export type TunnelMode = 'quick' | 'managed-remote' | 'managed-local';

/**
 * Cloudflare and Ngrok start paths spawn a local provider CLI.
 * Keep this explicit so a future API-only mode can opt out.
 */
export function tunnelModeRequiresProviderCli(mode: TunnelMode): boolean {
  return mode === 'quick' || mode === 'managed-remote' || mode === 'managed-local';
}

export function isRequiredTunnelProviderCliMissing(input: {
  dependencyAvailable: boolean | null;
  mode: TunnelMode;
}): boolean {
  if (input.dependencyAvailable !== false) {
    return false;
  }
  return tunnelModeRequiresProviderCli(input.mode);
}

export function formatMissingTunnelProviderCliReason(input: {
  notFound: string;
  installHint: string;
}): string {
  return `${input.notFound} ${input.installHint}`.trim();
}
