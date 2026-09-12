import { describe, expect, test } from 'bun:test';
import type { InlineCommentDraft } from '@/stores/useInlineCommentDraftStore';
import { getQueuedMessagePreview } from './queuedMessagePreview';

const draft = (partial: Partial<InlineCommentDraft> & Pick<InlineCommentDraft, 'source'>): InlineCommentDraft => ({
    id: 'd1',
    sessionKey: 's1',
    fileLabel: 'a.ts',
    startLine: 1,
    endLine: 1,
    code: '',
    language: 'ts',
    text: '',
    createdAt: 1,
    ...partial,
});

describe('queued message preview', () => {
    test('prefers composer text over context drafts', () => {
        expect(getQueuedMessagePreview({
            content: 'My prompt',
            contextDrafts: [draft({ source: 'chat-quote', text: 'Please explain this', code: 'Quoted answer' })],
        })).toBe('My prompt');
    });

    test('shows draft comment text, then code, then file label', () => {
        expect(getQueuedMessagePreview({
            content: '',
            contextDrafts: [draft({ source: 'chat-quote', text: 'Please explain this', code: 'Quoted answer' })],
        })).toBe('Please explain this');
        expect(getQueuedMessagePreview({
            content: ' ',
            contextDrafts: [draft({ source: 'terminal', text: '', code: 'Build failed', fileLabel: 'Shell' })],
        })).toBe('Build failed');
        expect(getQueuedMessagePreview({
            content: '',
            contextDrafts: [draft({ source: 'file', text: '', code: '', fileLabel: 'readme.md' })],
        })).toBe('readme.md');
    });

    test('falls back to attachment filename', () => {
        expect(getQueuedMessagePreview({
            content: '',
            attachments: [{ filename: 'notes.txt' } as any],
        })).toBe('notes.txt');
    });

    test('bounds long and multiline previews', () => {
        expect(getQueuedMessagePreview({ content: '\n First line\nSecond line' })).toBe('First line...');
        const long = 'a'.repeat(120);
        expect(getQueuedMessagePreview({ content: long })).toBe('a'.repeat(100) + '...');
    });
});
