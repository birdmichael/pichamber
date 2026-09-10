import { describe, expect, test } from 'bun:test';

import {
    classifyDictationCaptureError,
    createDictationCaptureError,
    dictationStartErrorMessageKey,
} from './dictation-capture-errors';

describe('classifyDictationCaptureError', () => {
    test('maps NotAllowedError to permission denied', () => {
        const err = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
        const classified = classifyDictationCaptureError(err);
        expect(classified.reasonCode).toBe('microphone_permission_denied');
        expect(classified.message).toBe('Microphone permission denied');
    });

    test('maps NotFoundError to no microphone', () => {
        const err = Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' });
        expect(classifyDictationCaptureError(err).reasonCode).toBe('microphone_not_found');
    });

    test('maps NotReadableError to unavailable', () => {
        const err = Object.assign(new Error('Device busy'), { name: 'NotReadableError' });
        expect(classifyDictationCaptureError(err).reasonCode).toBe('microphone_unavailable');
    });

    test('preserves an already classified reasonCode', () => {
        const original = createDictationCaptureError('x', 'microphone_unsupported');
        expect(classifyDictationCaptureError(original)).toBe(original);
    });

    test('classifies unsupported getUserMedia messages', () => {
        expect(classifyDictationCaptureError(new Error('getUserMedia is not supported')).reasonCode)
            .toBe('microphone_unsupported');
    });
});

describe('dictationStartErrorMessageKey', () => {
    test('never returns empty — every failure maps to a toast key', () => {
        const reasons = [
            'microphone_unsupported',
            'audio_context_unavailable',
            'microphone_permission_denied',
            'microphone_not_found',
            'microphone_unavailable',
            'model_download_in_progress',
            null,
            undefined,
            'something_else',
        ] as const;
        for (const reason of reasons) {
            const key = dictationStartErrorMessageKey(reason);
            expect(key.startsWith('chat.dictation.')).toBe(true);
            expect(key.length).toBeGreaterThan('chat.dictation.'.length);
        }
    });

    test('permission and missing-mic map to specific copy keys', () => {
        expect(dictationStartErrorMessageKey('microphone_permission_denied'))
            .toBe('chat.dictation.microphonePermissionDenied');
        expect(dictationStartErrorMessageKey('microphone_not_found'))
            .toBe('chat.dictation.microphoneNotFound');
        expect(dictationStartErrorMessageKey('microphone_unsupported'))
            .toBe('chat.dictation.unsupported');
        expect(dictationStartErrorMessageKey(null))
            .toBe('chat.dictation.startFailed');
    });
});
