/**
 * Regression: v1.2.20 ChatViewport passed onListMetricsChange={onListMetricsChange}
 * to MessageList without destructuring the prop (or declaring it on ChatViewportProps).
 * That is a runtime ReferenceError → ChatErrorBoundary ("聊天错误") on every chat render.
 * #764 wired the prop; this test keeps the destructure + MessageList pass aligned.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const chatContainerSource = readFileSync(join(__dirname, '..', 'ChatContainer.tsx'), 'utf-8');

describe('ChatViewport onListMetricsChange wiring', () => {
  test('ChatViewportProps declares onListMetricsChange', () => {
    expect(chatContainerSource).toMatch(
      /type ChatViewportProps = \{[\s\S]*?onListMetricsChange:\s*\(metrics:/,
    );
  });

  test('ChatViewport destructures onListMetricsChange from props', () => {
    const match = chatContainerSource.match(
      /const ChatViewport = React\.memo\(\(\{([\s\S]*?)\}: ChatViewportProps\)/,
    );
    expect(match).toBeTruthy();
    const destr = match![1];
    expect(destr).toMatch(/\bonListMetricsChange\b/);
  });

  test('ChatViewport forwards onListMetricsChange to MessageList', () => {
    // Narrow to the ChatViewport memo body (before displayName / next export).
    const start = chatContainerSource.indexOf('const ChatViewport = React.memo');
    const end = chatContainerSource.indexOf('ChatViewport.displayName', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = chatContainerSource.slice(start, end);
    expect(body).toMatch(/onListMetricsChange=\{onListMetricsChange\}/);
  });

  test('ChatContainer pulls onListMetricsChange from useChatTimelineScroll', () => {
    expect(chatContainerSource).toMatch(
      /const \{[\s\S]*?\bonListMetricsChange\b[\s\S]*?\} = useChatTimelineScroll\(/,
    );
  });
});
