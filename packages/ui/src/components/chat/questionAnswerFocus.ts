export const QUESTION_ANSWER_ATTR = 'data-question-answer';
const QUESTION_ANSWER_SELECTOR = `textarea[${QUESTION_ANSWER_ATTR}="true"]`;

type ClosestTarget = {
    closest?: (selector: string) => unknown;
    tagName?: string;
    getAttribute?: (name: string) => string | null;
};

export const isQuestionAnswerTextarea = (target: unknown): boolean => {
    if (!target || typeof target !== 'object') {
        return false;
    }

    const element = target as ClosestTarget;
    if (typeof element.closest === 'function') {
        return Boolean(element.closest(QUESTION_ANSWER_SELECTOR));
    }

    return element.tagName === 'TEXTAREA' && element.getAttribute?.(QUESTION_ANSWER_ATTR) === 'true';
};

export const shouldAutofocusComposer = ({
    active,
    currentSessionId,
    isMobile,
    hasPendingQuestionCard,
    hasPendingPiExtensionUi,
    activeElement,
}: {
    active: boolean;
    currentSessionId: string | null | undefined;
    isMobile: boolean;
    hasPendingQuestionCard: boolean;
    hasPendingPiExtensionUi: boolean;
    activeElement?: unknown;
}): boolean => {
    if (!active || !currentSessionId || isMobile) {
        return false;
    }
    if (hasPendingQuestionCard || hasPendingPiExtensionUi) {
        return false;
    }
    return !isQuestionAnswerTextarea(activeElement);
};

export const stopQuestionAnswerKeyBubble = (event: { stopPropagation: () => void }): void => {
    event.stopPropagation();
};
