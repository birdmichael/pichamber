import { describe, expect, test } from 'bun:test';

import { commitStreamedText } from './streamTextCommit';

describe('commitStreamedText', () => {
    test('holds an incomplete short paragraph entirely', () => {
        expect(commitStreamedText('An unfinished thought abo')).toBe('');
    });

    test('commits up to the last complete line', () => {
        expect(commitStreamedText('First paragraph.\n\nSecond par')).toBe('First paragraph.\n\n');
    });

    test('reveals code fences line by line', () => {
        const text = '```py\nprint("a")\nprint("b';
        expect(commitStreamedText(text)).toBe('```py\nprint("a")\n');
    });

    test('releases a long held paragraph at the last sentence boundary', () => {
        const sentence = 'A finished sentence lives here. ';
        const text = sentence.repeat(12) + 'and an unfinished trail';
        expect(commitStreamedText(text)).toBe(sentence.repeat(12));
    });

    test('falls back to the last word boundary without sentences', () => {
        const words = 'word '.repeat(70);
        const text = words + 'unfinishe';
        expect(commitStreamedText(text)).toBe(words);
    });

    test('keeps unbreakable runs intact rather than splitting them', () => {
        const run = 'x'.repeat(400);
        expect(commitStreamedText(run)).toBe(run);
    });

    test('empty input stays empty', () => {
        expect(commitStreamedText('')).toBe('');
    });

    test('releases a long CJK paragraph at the last ideographic sentence end', () => {
        const sentence = '这是一句用来测试中文句号边界的完整句子。';
        const text = sentence.repeat(17) + '还没写完的半句';
        expect(commitStreamedText(text)).toBe(sentence.repeat(17));
    });
});
