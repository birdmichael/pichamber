import type { QueuedMessage } from '@/stores/messageQueueStore';
import type { InlineCommentDraft } from '@/stores/useInlineCommentDraftStore';

function draftPreview(draft: InlineCommentDraft): string {
    const text = draft.text.trim();
    if (text) return text;
    const code = draft.code.trim();
    if (code) return code;
    return draft.fileLabel.trim();
}

/** Display-only summary; never substitute it for the editable or delivered text. */
export function getQueuedMessagePreview(message: Pick<QueuedMessage, 'content' | 'attachments' | 'contextDrafts'>): string {
    let text = message.content.trim();
    if (!text) {
        for (const draft of message.contextDrafts ?? []) {
            text = draftPreview(draft);
            if (text) break;
        }
    }
    text ||= message.attachments?.[0]?.filename ?? '';
    const firstLine = text.split('\n', 1)[0];
    return firstLine.slice(0, 100) + (text.length > firstLine.length || firstLine.length > 100 ? '...' : '');
}
