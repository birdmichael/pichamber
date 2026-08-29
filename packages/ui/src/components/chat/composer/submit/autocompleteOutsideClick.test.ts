import { describe, expect, test } from 'bun:test';

import {
    COMPOSER_SEND_ATTR,
    isComposerSendPointerTarget,
    shouldDismissAutocompleteOnOutsidePointer,
} from './autocompleteOutsideClick';

class TestElement {
    parent: TestElement | null = null;
    children: TestElement[] = [];
    private readonly attrs = new Map<string, string>();

    setAttribute(name: string, value: string): void {
        this.attrs.set(name, value);
    }

    appendChild(child: TestElement): TestElement {
        child.parent = this;
        this.children.push(child);
        return child;
    }

    contains(node: TestElement): boolean {
        if (node === this) return true;
        return this.children.some((child) => child.contains(node));
    }

    closest(selector: string): TestElement | null {
        if (selector !== `[${COMPOSER_SEND_ATTR}]`) return null;
        let current: TestElement | null = this;
        while (current) {
            if (current.attrs.has(COMPOSER_SEND_ATTR)) return current;
            current = current.parent;
        }
        return null;
    }
}

describe('shouldDismissAutocompleteOnOutsidePointer', () => {
    test('keeps the popup open when the pointer is already on send', () => {
        const originalElement = globalThis.Element;
        Object.defineProperty(globalThis, 'Element', { configurable: true, value: TestElement });
        try {
            const send = new TestElement();
            send.setAttribute(COMPOSER_SEND_ATTR, '');
            const icon = send.appendChild(new TestElement());
            const popup = new TestElement();
            expect(isComposerSendPointerTarget(icon as unknown as EventTarget)).toBe(true);
            expect(shouldDismissAutocompleteOnOutsidePointer(
                icon as unknown as EventTarget,
                popup as unknown as Node,
            )).toBe(false);
        } finally {
            Object.defineProperty(globalThis, 'Element', { configurable: true, value: originalElement });
        }
    });

    test('dismisses a true outside click', () => {
        const originalElement = globalThis.Element;
        Object.defineProperty(globalThis, 'Element', { configurable: true, value: TestElement });
        try {
            const popup = new TestElement();
            const inside = popup.appendChild(new TestElement());
            const outside = new TestElement();
            expect(shouldDismissAutocompleteOnOutsidePointer(
                outside as unknown as EventTarget,
                popup as unknown as Node,
            )).toBe(true);
            expect(shouldDismissAutocompleteOnOutsidePointer(
                inside as unknown as EventTarget,
                popup as unknown as Node,
            )).toBe(false);
        } finally {
            Object.defineProperty(globalThis, 'Element', { configurable: true, value: originalElement });
        }
    });
});
