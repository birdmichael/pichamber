import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Wiring contract for #662: Start dictation / Ctrl+Alt+V must never silent
 * no-op — failures toast; the toggle listener stays registered for host buttons
 * and the keyboard shortcut even when the trigger chrome is hidden.
 */
describe('ComposerDictation start feedback wiring', () => {
    const source = readFileSync(join(__dirname, 'ComposerDictation.tsx'), 'utf-8');
    const hookSource = readFileSync(join(__dirname, '../../hooks/useDictation.ts'), 'utf-8');

    test('start path toasts unsupported, disabled, and capture failures', () => {
        expect(source).toContain('requestStartDictation');
        expect(source).toContain("toast.error(t('chat.dictation.unsupported'))");
        expect(source).toContain("toast.error(t('chat.dictation.disabled'))");
        expect(source).toContain('showStartFailureToast');
        expect(source).toContain('dictationStartErrorMessageKey');
    });

    test('toggle event and mic trigger both go through requestStartDictation', () => {
        expect(source).toContain("addEventListener('openchamber:dictation-toggle'");
        expect(source).toMatch(/void requestStartDictation\(\)/);
        expect(source).toContain('Listener stays registered even when the trigger is hidden');
    });

    test('useDictation rethrows start failures so idle UI can toast', () => {
        expect(hookSource).toContain('throw toError(err)');
        expect(hookSource).toContain('previously looked like a no-op');
    });
});
