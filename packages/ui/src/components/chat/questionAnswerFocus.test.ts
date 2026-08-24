import { describe, expect, test } from 'bun:test';
import {
    QUESTION_ANSWER_ATTR,
    isQuestionAnswerTextarea,
    shouldAutofocusComposer,
    stopQuestionAnswerKeyBubble,
} from './questionAnswerFocus';

const answerTextarea = {
    tagName: 'TEXTAREA',
    getAttribute: (name: string) => (name === QUESTION_ANSWER_ATTR ? 'true' : null),
    closest: (selector: string) => (selector.includes(QUESTION_ANSWER_ATTR) ? answerTextarea : null),
};

describe('isQuestionAnswerTextarea', () => {
    test('matches the Q&A / extension answer field', () => {
        expect(isQuestionAnswerTextarea(answerTextarea)).toBe(true);
        expect(isQuestionAnswerTextarea({ tagName: 'DIV', closest: () => null })).toBe(false);
        expect(isQuestionAnswerTextarea(null)).toBe(false);
    });
});

describe('shouldAutofocusComposer', () => {
    const ready = {
        active: true,
        currentSessionId: 'ses_1',
        isMobile: false,
        hasPendingQuestionCard: false,
        hasPendingPiExtensionUi: false,
    };

    test('autofocuses a normal idle session', () => {
        expect(shouldAutofocusComposer(ready)).toBe(true);
    });

    test('does not steal focus while a QuestionCard is pending', () => {
        expect(shouldAutofocusComposer({ ...ready, hasPendingQuestionCard: true })).toBe(false);
    });

    test('does not steal focus while a Pi extension prompt is pending', () => {
        expect(shouldAutofocusComposer({ ...ready, hasPendingPiExtensionUi: true })).toBe(false);
    });

    test('does not steal focus from the answer textarea', () => {
        expect(shouldAutofocusComposer({ ...ready, activeElement: answerTextarea })).toBe(false);
    });
});

describe('stopQuestionAnswerKeyBubble', () => {
    test('stops the key from reaching the composer', () => {
        let stopped = false;
        stopQuestionAnswerKeyBubble({ stopPropagation: () => { stopped = true; } });
        expect(stopped).toBe(true);
    });
});
