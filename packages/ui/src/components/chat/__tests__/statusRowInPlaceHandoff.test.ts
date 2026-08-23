/**
 * OpenChamber 1.20.0 layout contract: the live model status line under the
 * last message must occupy the same slot as the finished turn footer so the
 * swap does not jump when the reply completes.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const statusRowSource = readFileSync(join(here, '../StatusRow.tsx'), 'utf8');
const workingPlaceholderSource = readFileSync(
  join(here, '../message/parts/WorkingPlaceholder.tsx'),
  'utf8',
);
const messageBodySource = readFileSync(join(here, '../message/MessageBody.tsx'), 'utf8');

describe('status-line → finished info-row in-place handoff', () => {
  test('StatusRow reserves the finished footer slot (mb-6, h-8)', () => {
    expect(statusRowSource).toContain('className={cn("mb-6", !hasLeftAccessory && "chat-column")}');
    expect(statusRowSource).toContain(
      'className={cn("flex items-center justify-between gap-2 h-8", hasLeftAccessory && "px-0.5")}',
    );
    expect(statusRowSource).not.toMatch(
      /flex items-center justify-between py-0\.5 gap-2 h-\[1\.2rem\]/,
    );
    expect(statusRowSource).not.toMatch(/className=\{cn\("mb-1", isMobile && "mt-2"/);
  });

  test('WorkingPlaceholder streaming line matches the turn footer model row', () => {
    expect(workingPlaceholderSource).toContain("'flex h-full items-center text-muted-foreground/60'");
    expect(workingPlaceholderSource).toContain('<span className="text-sm">');
    expect(messageBodySource).toContain(
      'flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground/60',
    );
  });
});
