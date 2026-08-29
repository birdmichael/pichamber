import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const chatContainerSource = readFileSync(join(here, '../ChatContainer.tsx'), 'utf8');
const chatInputSource = readFileSync(join(here, '../ChatInput.tsx'), 'utf8');

describe('empty existing session welcome chrome', () => {
  test('ChatInput shares New session title and starter chips when emptySessionWelcome is set', () => {
    expect(chatInputSource).toContain('shouldShowDesktopDraftWelcomeChrome');
    expect(chatInputSource).toContain('emptySessionWelcome');
    expect(chatInputSource).toContain('resolveWelcomeWorkspaceLabel');
    expect(chatInputSource).toContain('<DraftPresetChips');
    expect(chatInputSource).not.toMatch(
      /newSessionDraftOpen && !isDesktopExpanded && !isMobile && !isVSCode && !isMiniChatSurface/,
    );
  });

  test('ChatContainer empty session mounts DraftWelcome, chips via ChatInput, and Work Status', () => {
    const emptyBusyGuard = 'if (sessionMessages.length === 0 && !sessionIsWorking && !hasTranscriptChrome && !pendingComposerVisible)';
    const emptyStateReturn = chatContainerSource.indexOf(emptyBusyGuard);
    expect(emptyStateReturn).toBeGreaterThan(-1);
    const emptyStateBlock = chatContainerSource.slice(emptyStateReturn, emptyStateReturn + 2400);
    expect(emptyStateBlock).toContain('<DraftWelcome');
    expect(emptyStateBlock).toContain('sessionDirectory={effectiveSessionDirectory}');
    expect(emptyStateBlock).toContain('emptySessionWelcome');
    expect(emptyStateBlock).toContain('<WorkStatusPanel');
    expect(emptyStateBlock).toContain('sessionId={currentSessionId}');
    expect(emptyStateBlock).not.toContain('<ChatEmptyState');
  });
});
