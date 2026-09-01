import type { Part } from '@opencode-ai/sdk/v2';

import type { I18nKey, I18nParams } from '@/lib/i18n';
import { readContextPart, type ContextPartPayload } from '@/lib/messages/contextParts';

type Translate = (key: I18nKey, params?: I18nParams) => string;

type TextPartLike = Part & { type: 'text'; text: string };

const isTextPart = (part: Part): part is TextPartLike => part.type === 'text' && typeof part.text === 'string';

export function getFullText(parts: Part[]): string {
    return parts
        .filter(isTextPart)
        .map((p) => p.text)
        .join('\n');
}

const basename = (path: string): string => {
    const segments = path.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? path;
};

const contextSummary = (payload: ContextPartPayload, t: Translate): string => {
    switch (payload.kind) {
        case 'code-comment': {
            const file = basename(payload.fileLabel);
            return payload.startLine === payload.endLine
                ? t('chat.message.context.codeCommentLine', { file, line: payload.startLine })
                : t('chat.message.context.codeComment', { file, start: payload.startLine, end: payload.endLine });
        }
        case 'terminal':
            return t('chat.message.terminalContext', {
                terminal: payload.terminalLabel,
                start: payload.startLine,
                end: payload.endLine,
            });
        case 'browser-annotation':
            return t('chat.message.context.browserAnnotation', { page: payload.pageUrl });
        case 'preview-console':
            return t('chat.message.context.previewConsole', { file: basename(payload.fileLabel) });
        case 'pr-comment':
            return t('chat.message.context.prComment', { label: payload.label });
        case 'pr-check':
            return t('chat.message.context.prCheck', { label: payload.label });
        case 'file-quote': {
            const file = basename(payload.fileLabel);
            if (payload.startLine == null || payload.endLine == null) {
                return t('chat.message.context.fileQuote', { file });
            }
            return payload.startLine === payload.endLine
                ? t('chat.message.context.codeCommentLine', { file, line: payload.startLine })
                : t('chat.message.context.codeComment', { file, start: payload.startLine, end: payload.endLine });
        }
        case 'chat-quote':
            return t('chat.message.context.chatQuote');
        case 'github-issue':
            return `#${payload.number} ${payload.title}`;
        case 'github-pr':
            return `#${payload.number} ${payload.title}`;
        case 'linear-issue':
            return `${payload.identifier} ${payload.title}`;
    }
};

const contextBody = (payload: ContextPartPayload): string => {
    switch (payload.kind) {
        case 'code-comment':
            return payload.code;
        case 'terminal':
            return payload.output;
        case 'browser-annotation':
            return payload.prompt;
        case 'preview-console':
            return payload.output;
        case 'pr-comment':
            return payload.body;
        case 'pr-check':
            return payload.output;
        case 'file-quote':
        case 'chat-quote':
            return payload.quote;
        case 'github-issue':
        case 'github-pr':
        case 'linear-issue':
            return '';
    }
};

const contextPreview = (payload: ContextPartPayload, t: Translate): string => {
    const summary = contextSummary(payload, t);
    const comment = 'text' in payload ? payload.text.trim() : '';
    const detail = comment.length > 0 ? comment : contextBody(payload).trim();
    return detail.length > 0 ? `${summary}: ${detail}` : summary;
};

export function getPromptPreviewText(parts: Part[], t?: Translate): string {
    const typed = parts
        .filter(isTextPart)
        .filter((p) => readContextPart(p) === null)
        .map((p) => p.text.trim())
        .filter((text) => text.length > 0);
    if (typed.length > 0) {
        return typed.join('\n');
    }

    if (t) {
        const contextLines = parts
            .map((part) => readContextPart(part))
            .filter((payload): payload is ContextPartPayload => payload !== null)
            .map((payload) => contextPreview(payload, t))
            .filter((line) => line.length > 0);
        if (contextLines.length > 0) {
            return contextLines.join(' · ');
        }
    }

    return getFullText(parts);
}

export function getMessagePreview(parts: Part[], maxLength = 80, t?: Translate): string {
    const full = getPromptPreviewText(parts, t);
    const singleLine = full.replace(/\n/g, ' ');
    return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}…` : singleLine;
}
