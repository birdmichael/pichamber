/**
 * Classify microphone / AudioContext failures for dictation start feedback.
 * Keep reason codes stable — UI maps them to i18n toasts.
 */

export type DictationCaptureReasonCode =
    | 'microphone_unsupported'
    | 'audio_context_unavailable'
    | 'microphone_permission_denied'
    | 'microphone_not_found'
    | 'microphone_unavailable';

export type DictationCaptureError = Error & { reasonCode: DictationCaptureReasonCode };

export const createDictationCaptureError = (
    message: string,
    reasonCode: DictationCaptureReasonCode,
): DictationCaptureError => {
    const error = new Error(message) as DictationCaptureError;
    error.reasonCode = reasonCode;
    return error;
};

const mediaErrorName = (err: unknown): string => {
    if (typeof err === 'object' && err && 'name' in err) {
        return String((err as { name?: unknown }).name || '');
    }
    return '';
};

/**
 * Map getUserMedia / AudioContext failures to a typed capture error.
 * DomException names are the primary signal; message text is fallback only.
 */
export const classifyDictationCaptureError = (err: unknown): DictationCaptureError => {
    if (err && typeof err === 'object' && 'reasonCode' in err) {
        const existing = err as Error & { reasonCode?: string };
        if (
            existing.reasonCode === 'microphone_unsupported'
            || existing.reasonCode === 'audio_context_unavailable'
            || existing.reasonCode === 'microphone_permission_denied'
            || existing.reasonCode === 'microphone_not_found'
            || existing.reasonCode === 'microphone_unavailable'
        ) {
            return existing as DictationCaptureError;
        }
    }

    const name = mediaErrorName(err);
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        return createDictationCaptureError('Microphone permission denied', 'microphone_permission_denied');
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return createDictationCaptureError('No microphone found', 'microphone_not_found');
    }
    if (name === 'NotReadableError' || name === 'AbortError' || name === 'OverconstrainedError') {
        return createDictationCaptureError('Unable to access the microphone', 'microphone_unavailable');
    }

    const message = err instanceof Error ? err.message : String(err);
    if (/not supported|mediaDevices|getUserMedia/i.test(message)) {
        return createDictationCaptureError(message || 'Microphone capture is not supported', 'microphone_unsupported');
    }
    if (/AudioContext/i.test(message)) {
        return createDictationCaptureError(message || 'AudioContext unavailable', 'audio_context_unavailable');
    }
    return createDictationCaptureError(
        message || 'Unable to access the microphone',
        'microphone_unavailable',
    );
};

export type DictationStartErrorMessageKey =
    | 'chat.dictation.unsupported'
    | 'chat.dictation.microphonePermissionDenied'
    | 'chat.dictation.microphoneNotFound'
    | 'chat.dictation.microphoneUnavailable'
    | 'chat.dictation.startFailed';

/** i18n key for a start-dictation failure toast (never silent). */
export const dictationStartErrorMessageKey = (
    reasonCode: string | null | undefined,
): DictationStartErrorMessageKey => {
    switch (reasonCode) {
        case 'microphone_unsupported':
        case 'audio_context_unavailable':
            return 'chat.dictation.unsupported';
        case 'microphone_permission_denied':
            return 'chat.dictation.microphonePermissionDenied';
        case 'microphone_not_found':
            return 'chat.dictation.microphoneNotFound';
        case 'microphone_unavailable':
            return 'chat.dictation.microphoneUnavailable';
        default:
            return 'chat.dictation.startFailed';
    }
};
