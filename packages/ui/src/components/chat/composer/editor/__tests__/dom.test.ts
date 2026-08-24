import { afterEach, expect, test } from 'bun:test';

import { focusChatInput } from '../dom';

const originalDocument = globalThis.document;

afterEach(() => {
    globalThis.document = originalDocument;
});

test('focuses the CodeMirror chat input content', () => {
    let selector = '';
    let focused = false;
    globalThis.document = {
        activeElement: null,
        querySelector: (value: string) => {
            selector = value;
            return { focus: () => { focused = true; } };
        },
    } as unknown as Document;

    focusChatInput();

    expect(selector).toBe('[data-chat-input="true"] .cm-content');
    expect(focused).toBe(true);
});

test('does not steal focus from a Q&A answer textarea', () => {
    let focused = false;
    const textarea = {
        closest: (selector: string) => (selector.includes('data-question-answer') ? textarea : null),
    };
    globalThis.document = {
        activeElement: textarea,
        querySelector: () => ({ focus: () => { focused = true; } }),
    } as unknown as Document;

    focusChatInput();

    expect(focused).toBe(false);
});
