import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import {
  COMPOSER_AGENT_SLOT_HIDE_BELOW_PX,
  COMPOSER_AGENT_SLOT_HIDE_CLASS,
  measureComposerAgentSlot,
  shouldHideComposerAgentSlot,
} from './composerAgentSlotLayout';

const __dirname = dirname(fileURLToPath(import.meta.url));
const composerFooterSource = readFileSync(join(__dirname, './ComposerFooter.tsx'), 'utf-8');
const indexCss = readFileSync(join(__dirname, '../../../../index.css'), 'utf-8');
const appSource = readFileSync(join(__dirname, '../../../../App.tsx'), 'utf-8');
const chatInputSource = readFileSync(join(__dirname, '../../ChatInput.tsx'), 'utf-8');
const chatViewSource = readFileSync(
  join(__dirname, '../../../views/ChatView.tsx'),
  'utf-8',
);
const embeddedSource = readFileSync(
  join(__dirname, '../../../layout/contextPanelEmbeddedChat.ts'),
  'utf-8',
);

describe('shouldHideComposerAgentSlot', () => {
  test('hides Agent below 576px (child/embedded footer band)', () => {
    expect(COMPOSER_AGENT_SLOT_HIDE_BELOW_PX).toBe(576);
    expect(shouldHideComposerAgentSlot({ rowWidth: 315 })).toBe(true);
    expect(shouldHideComposerAgentSlot({ rowWidth: 500 })).toBe(true);
    expect(shouldHideComposerAgentSlot({ rowWidth: 575 })).toBe(true);
  });

  test('keeps Agent on a wide parent chip row (~1000px)', () => {
    expect(shouldHideComposerAgentSlot({ rowWidth: 576 })).toBe(false);
    expect(shouldHideComposerAgentSlot({ rowWidth: 1000 })).toBe(false);
  });

  test('hides Agent when the slot overflow-clips even if the row is wide', () => {
    expect(shouldHideComposerAgentSlot({
      rowWidth: 1000,
      agentScrollWidth: 80,
      agentClientWidth: 24,
    })).toBe(true);
  });

  test('does not treat a display:none slot (clientWidth 0) as overflow', () => {
    expect(shouldHideComposerAgentSlot({
      rowWidth: 1000,
      agentScrollWidth: 0,
      agentClientWidth: 0,
    })).toBe(false);
  });
});

describe('measureComposerAgentSlot', () => {
  test('reads the chip row width and Agent slot overflow box', () => {
    const slot = {
      scrollWidth: 64,
      clientWidth: 20,
    };
    const row = {
      clientWidth: 420,
      querySelector: (selector: string) => {
        expect(selector).toBe('.model-controls__agent-slot');
        return slot;
      },
    } as unknown as HTMLElement;

    expect(measureComposerAgentSlot(row)).toEqual({
      rowWidth: 420,
      agentScrollWidth: 64,
      agentClientWidth: 20,
    });
    expect(shouldHideComposerAgentSlot(measureComposerAgentSlot(row))).toBe(true);
  });
});

describe('child/embedded composer Agent hide wiring', () => {
  test('embedded session-chat iframe mounts the same ChatInput footer', () => {
    expect(embeddedSource).toContain("get('ocPanel') === 'session-chat'");
    expect(appSource).toContain('isEmbeddedSessionChat');
    expect(appSource).toContain('<ChatView');
    expect(chatViewSource).toContain('<ChatContainer');
    expect(chatInputSource).toContain('<ComposerFooter');
    expect(composerFooterSource).toContain('data-chat-input-footer="true"');
    expect(composerFooterSource).toContain('data-composer-chip-row="true"');
  });

  test('parent and child footers are model-controls containers', () => {
    expect(composerFooterSource).toContain('@container/model-controls');
    expect(composerFooterSource).toMatch(
      /data-chat-input-footer="true"[\s\S]*?data-composer-chip-row="true"|data-composer-chip-row="true"[\s\S]*?@container\/model-controls/,
    );
    expect(indexCss).toMatch(
      /div\[data-chat-input-footer="true"\][\s\S]*?\[data-composer-chip-row="true"\][\s\S]*?container-type:\s*inline-size;[\s\S]*?container-name:\s*model-controls;/,
    );
  });

  test('measure hook hides Agent below 576px via display:none class', () => {
    expect(composerFooterSource).toContain('useComposerAgentSlotHide');
    expect(composerFooterSource).toContain('chipRowRef');
    expect(composerFooterSource).toContain('COMPOSER_AGENT_SLOT_HIDE_CLASS');
    expect(COMPOSER_AGENT_SLOT_HIDE_CLASS).toBe('model-controls--hide-agent');
    expect(indexCss).toMatch(
      /\.model-controls--hide-agent \.model-controls__agent-slot[\s\S]*?display:\s*none;/,
    );
    expect(indexCss).toMatch(
      /\.model-controls--hide-agent \.model-controls__agent-trigger[\s\S]*?display:\s*none;/,
    );
  });

  test('36rem Agent hide query is not nested under html', () => {
    expect(indexCss).toMatch(
      /@container model-controls \(max-width: 36rem\)\s*\{[\s\S]*?\.model-controls__agent-slot[\s\S]*?display:\s*none;/,
    );
    expect(indexCss).not.toMatch(
      /html:not\(\.vscode-runtime\) \{\s*@container model-controls \(max-width: 36rem\)/,
    );
  });
});
