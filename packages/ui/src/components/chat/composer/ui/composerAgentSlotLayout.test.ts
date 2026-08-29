import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import {
  COMPOSER_AGENT_SLOT_HIDE_BELOW_PX,
  COMPOSER_AGENT_SLOT_HIDE_CLASS,
  COMPOSER_FOOTER_SELECTOR,
  PARENT_CHAT_COLUMN_SELECTOR,
  measureComposerAgentSlot,
  observeParentChatColumnAgentOmit,
  shouldHideComposerAgentSlot,
  shouldOmitComposerAgentSlot,
} from './composerAgentSlotLayout';

const __dirname = dirname(fileURLToPath(import.meta.url));
const composerFooterSource = readFileSync(join(__dirname, './ComposerFooter.tsx'), 'utf-8');
const layoutSource = readFileSync(join(__dirname, './composerAgentSlotLayout.ts'), 'utf-8');
const indexCss = readFileSync(join(__dirname, '../../../../index.css'), 'utf-8');
const appSource = readFileSync(join(__dirname, '../../../../App.tsx'), 'utf-8');
const chatInputSource = readFileSync(join(__dirname, '../../ChatInput.tsx'), 'utf-8');
const modelControlsSource = readFileSync(join(__dirname, '../../ModelControls.tsx'), 'utf-8');
const chatViewSource = readFileSync(
  join(__dirname, '../../../views/ChatView.tsx'),
  'utf-8',
);
const chatContainerSource = readFileSync(
  join(__dirname, '../../ChatContainer.tsx'),
  'utf-8',
);
const embeddedSource = readFileSync(
  join(__dirname, '../../../layout/contextPanelEmbeddedChat.ts'),
  'utf-8',
);

describe('shouldOmitComposerAgentSlot', () => {
  test('omits Agent when the parent column width is 328', () => {
    expect(COMPOSER_AGENT_SLOT_HIDE_BELOW_PX).toBe(576);
    expect(shouldOmitComposerAgentSlot(328)).toBe(true);
    expect(shouldOmitComposerAgentSlot(575)).toBe(true);
    expect(shouldOmitComposerAgentSlot(576)).toBe(false);
    expect(shouldOmitComposerAgentSlot(1000)).toBe(false);
    expect(shouldOmitComposerAgentSlot(0)).toBe(false);
    expect(shouldOmitComposerAgentSlot(undefined)).toBe(false);
  });

  test('omits Agent from a squeezed footer when the column lookup missed', () => {
    expect(shouldOmitComposerAgentSlot(undefined, 328)).toBe(true);
    expect(shouldOmitComposerAgentSlot(0, 575)).toBe(true);
    expect(shouldOmitComposerAgentSlot(undefined, 576)).toBe(false);
    // A measured wide column wins over a squeezed overflowing footer.
    expect(shouldOmitComposerAgentSlot(1000, 328)).toBe(false);
  });
});

describe('shouldHideComposerAgentSlot', () => {
  test('hides Agent below 576px (child/embedded footer band)', () => {
    expect(COMPOSER_AGENT_SLOT_HIDE_BELOW_PX).toBe(576);
    expect(shouldHideComposerAgentSlot({ rowWidth: 315 })).toBe(true);
    expect(shouldHideComposerAgentSlot({ rowWidth: 500 })).toBe(true);
    expect(shouldHideComposerAgentSlot({ rowWidth: 575 })).toBe(true);
  });

  test('hides Agent at a 328px parent column even if the chip row looks wide', () => {
    // Original 1280 squeeze: parent column is ~328px. A 2-letter
    // `Ag` truncation is a fail — omit/hide the whole slot, not a compact label.
    expect(shouldHideComposerAgentSlot({
      rowWidth: 800,
      footerWidth: 800,
      parentColumnWidth: 328,
    })).toBe(true);
    expect(shouldHideComposerAgentSlot({
      rowWidth: 800,
      footerWidth: 328,
    })).toBe(true);
    expect(shouldHideComposerAgentSlot({ footerWidth: 328, rowWidth: 0 })).toBe(true);
    expect(shouldHideComposerAgentSlot({ footerWidth: 575, rowWidth: 1000 })).toBe(true);
  });

  test('keeps Agent on a wide parent chip row (~1000px)', () => {
    expect(shouldHideComposerAgentSlot({ rowWidth: 576 })).toBe(false);
    expect(shouldHideComposerAgentSlot({
      rowWidth: 1000,
      footerWidth: 1000,
      parentColumnWidth: 1000,
    })).toBe(false);
  });

  test('hides Agent when the slot overflow-clips even if the row is wide', () => {
    expect(shouldHideComposerAgentSlot({
      rowWidth: 1000,
      footerWidth: 1000,
      parentColumnWidth: 1000,
      agentScrollWidth: 80,
      agentClientWidth: 24,
    })).toBe(true);
  });

  test('hides Agent when the label overflow-clips to Ag', () => {
    expect(shouldHideComposerAgentSlot({
      rowWidth: 1000,
      footerWidth: 1000,
      parentColumnWidth: 1000,
      agentScrollWidth: 24,
      agentClientWidth: 24,
      agentLabelScrollWidth: 48,
      agentLabelClientWidth: 16,
    })).toBe(true);
  });

  test('does not treat a display:none slot (clientWidth 0) as overflow', () => {
    expect(shouldHideComposerAgentSlot({
      rowWidth: 1000,
      footerWidth: 1000,
      parentColumnWidth: 1000,
      agentScrollWidth: 0,
      agentClientWidth: 0,
    })).toBe(false);
  });
});

describe('measureComposerAgentSlot', () => {
  test('reads the parent column, footer, chip row, and Agent slot overflow box', () => {
    const slot = {
      scrollWidth: 64,
      clientWidth: 20,
    };
    const label = {
      scrollWidth: 48,
      clientWidth: 16,
    };
    const footer = {
      clientWidth: 400,
    };
    const column = {
      clientWidth: 328,
    };
    const row = {
      clientWidth: 420,
      querySelector: (selector: string) => {
        if (selector === '.model-controls__agent-slot') return slot;
        if (selector === '.model-controls__agent-label') return label;
        return null;
      },
      closest: (selector: string) => {
        if (selector === '[data-chat-input-footer="true"]') return footer;
        if (selector === PARENT_CHAT_COLUMN_SELECTOR) return column;
        return null;
      },
    } as unknown as HTMLElement;

    expect(PARENT_CHAT_COLUMN_SELECTOR).toBe('[data-parent-chat-column="true"]');
    expect(measureComposerAgentSlot(row)).toEqual({
      rowWidth: 420,
      footerWidth: 400,
      parentColumnWidth: 328,
      agentScrollWidth: 64,
      agentClientWidth: 20,
      agentLabelScrollWidth: 48,
      agentLabelClientWidth: 16,
    });
    expect(shouldHideComposerAgentSlot(measureComposerAgentSlot(row))).toBe(true);
    expect(shouldOmitComposerAgentSlot(measureComposerAgentSlot(row).parentColumnWidth)).toBe(true);
  });
});

describe('observeParentChatColumnAgentOmit', () => {
  test('omit becomes true when the column is 328px after a late-mounted host', () => {
    const rafQueue: FrameRequestCallback[] = [];
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCaf = globalThis.cancelAnimationFrame;
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');

    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      rafQueue[id - 1] = () => undefined;
    }) as typeof cancelAnimationFrame;

    const column = { clientWidth: 328 };
    const footer = { clientWidth: 800 };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: {
        querySelector: (selector: string) => {
          if (selector === PARENT_CHAT_COLUMN_SELECTOR) return column;
          if (selector === COMPOSER_FOOTER_SELECTOR) return footer;
          return null;
        },
      },
    });
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: class {
        observe() { /* column width is already 328; update() runs before observe */ }
        disconnect() { /* noop */ }
        unobserve() { /* noop */ }
      },
    });

    const flushRaf = () => {
      const queued = rafQueue.splice(0);
      for (const cb of queued) {
        cb(0);
      }
    };

    const hostRef: { current: HTMLElement | null } = { current: null };
    let omit = false;
    const stop = observeParentChatColumnAgentOmit(hostRef, (next) => {
      omit = next;
    });

    try {
      // First effect: host is still null, so omit stays false.
      expect(omit).toBe(false);
      flushRaf();
      expect(omit).toBe(false);

      // Ref attaches after the first effect. closest can miss if the host is
      // not under the column yet; document.querySelector finds the 328px column.
      hostRef.current = {
        closest: () => null,
      } as unknown as HTMLElement;
      flushRaf();
      expect(omit).toBe(true);
    } finally {
      stop();
      globalThis.requestAnimationFrame = originalRaf;
      globalThis.cancelAnimationFrame = originalCaf;
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
      else Reflect.deleteProperty(globalThis, 'document');
      if (originalResizeObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalResizeObserver);
      else Reflect.deleteProperty(globalThis, 'ResizeObserver');
    }
  });
});

describe('parent main-window composer Agent hide wiring', () => {
  test('parent ChatInput reads [data-parent-chat-column] and omits Agent from the DOM', () => {
    expect(chatContainerSource).toContain('data-parent-chat-column="true"');
    expect(chatContainerSource).toContain('<ChatInput');
    expect(chatInputSource).toContain('<ComposerFooter');
    expect(chatInputSource).toContain('useParentChatColumnAgentOmit');
    expect(chatInputSource).toContain('composerFormRef');
    expect(chatInputSource).toContain('[data-parent-chat-column]');
    expect(layoutSource).toContain('observeParentChatColumnAgentOmit');
    expect(layoutSource).toContain('requestAnimationFrame');
    expect(layoutSource).toContain("document.querySelector<HTMLElement>(PARENT_CHAT_COLUMN_SELECTOR)");
    expect(layoutSource).toContain('COMPOSER_FOOTER_SELECTOR');
    expect(chatInputSource).toContain('omitAgentSlot={omitParentColumnAgentSlot}');
    expect(composerFooterSource).toContain('omitAgentSlot={omitAgentSlot}');
    expect(composerFooterSource).toContain('useComposerAgentSlotHide');
    expect(composerFooterSource).toContain('footerRef');
    expect(composerFooterSource).toContain('chipRowRef');
    expect(composerFooterSource).toContain('data-chat-input-footer="true"');
    expect(composerFooterSource).toMatch(/ref=\{footerRef\}[\s\S]*?data-chat-input-footer="true"/);
    expect(composerFooterSource).toContain('COMPOSER_AGENT_SLOT_HIDE_CLASS');
  });

  test('when parent column width is 328, Agent slot is not rendered', () => {
    expect(shouldOmitComposerAgentSlot(328)).toBe(true);
    expect(shouldHideComposerAgentSlot({
      rowWidth: 800,
      footerWidth: 800,
      parentColumnWidth: 328,
    })).toBe(true);
    expect(modelControlsSource).toMatch(
      /omitAgentSlot \? null[\s\S]*?model-controls__agent-slot/,
    );
    expect(composerFooterSource).toContain('omitAgentSlot={omitAgentSlot}');
    expect(chatInputSource).toContain('omitAgentSlot={omitParentColumnAgentSlot}');
    expect(COMPOSER_AGENT_SLOT_HIDE_CLASS).toBe('model-controls--hide-agent');
    expect(indexCss).toMatch(
      /\.model-controls--hide-agent \.model-controls__agent-slot[\s\S]*?display:\s*none;/,
    );
    expect(indexCss).toMatch(
      /\.model-controls--hide-agent \.model-controls__agent-trigger[\s\S]*?display:\s*none;/,
    );
    expect(composerFooterSource).toMatch(
      /hideAgentSlot && COMPOSER_AGENT_SLOT_HIDE_CLASS/,
    );
    // Compact `Ag` ellipsis is a fail — hide the chip instead.
    expect(indexCss).not.toMatch(
      /html:not\(\.vscode-runtime\):not\(\.mobile-pointer\) \.model-controls__agent-label \{[^}]*text-overflow:\s*ellipsis;/,
    );
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
    expect(composerFooterSource).toContain('footerRef');
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
    // Starting the subject at html never matches a footer descendant.
    expect(indexCss).not.toMatch(
      /@container model-controls \(max-width: 36rem\)\s*\{\s*html:not\(\.vscode-runtime\)/,
    );
  });
});
