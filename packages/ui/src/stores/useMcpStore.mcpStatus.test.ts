import { describe, expect, test } from 'bun:test';
import type { McpStatus } from '@opencode-ai/sdk/v2';
import { computeMcpHealth, isMcpStatusActive, mcpStatusName } from './useMcpStore';

const asStatus = (status: string): McpStatus => ({ status } as McpStatus);

describe('adapter MCP status mapping', () => {
  test('treats cached as a valid active row, not a failure', () => {
    expect(isMcpStatusActive(asStatus('connected'))).toBe(true);
    expect(isMcpStatusActive(asStatus('cached'))).toBe(true);
    expect(isMcpStatusActive(asStatus('failed'))).toBe(false);
    expect(isMcpStatusActive(asStatus('disabled'))).toBe(false);
    expect(isMcpStatusActive(asStatus('needs_auth'))).toBe(false);
    expect(mcpStatusName(asStatus('cached'))).toBe('cached');
  });

  test('counts cached servers in health without marking them failed', () => {
    const health = computeMcpHealth({
      docs: asStatus('cached'),
      repo: asStatus('connected'),
      off: asStatus('disabled'),
    });
    expect(health.connected).toBe(2);
    expect(health.total).toBe(3);
    expect(health.hasFailed).toBe(false);
  });
});

describe('work-status context MCP count', () => {
  test('Context sources uses the same active count as Work Status MCP', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const section = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../components/chat/work-status/WorkStatusContextSection.tsx'),
      'utf8',
    );
    expect(section).toContain('computeMcpHealth(mcpStatus).connected');
    expect(section).not.toContain("entry?.status === 'connected'");
  });
});
