import { beforeEach, describe, expect, test } from 'bun:test';
import type { Message, Part } from '@opencode-ai/sdk/v2';

import {
    hasPendingUserTranscriptPaint,
    isHiddenUserMessage,
    isPendingUserMessagePaint,
} from './hiddenUserMessage';
import { normalizeUserDisplayParts } from './normalizeUserDisplayParts';
import { emptyFeaturePluginsPayload } from '@/components/sections/feature-plugins/featurePlugins';
import {
    applyFeaturePluginsPayload,
    resetPiFeaturePluginsStore,
} from '@/sync/pi-feature-plugins-store';

const userMessage = (parts: Part[]): { info: Message; parts: Part[] } => ({
    info: { id: 'msg_user', role: 'user', sessionID: 'ses_1', time: { created: 1 } } as Message,
    parts,
});

describe('user message visibility', () => {
    test('hides user messages that have only an empty text shell', () => {
        const entry = userMessage([{ type: 'text', text: '' } as Part]);
        expect(isHiddenUserMessage(entry, { planModeEnabled: false })).toBe(true);
        expect(isPendingUserMessagePaint(entry, { planModeEnabled: false })).toBe(true);
        expect(normalizeUserDisplayParts(entry.parts)).toEqual([]);
    });

    test('hides stray session-directory chrome and does not treat it as pending text', () => {
        const entry = userMessage([{ type: 'text', text: '/workspace/pichamber' } as Part]);
        expect(isHiddenUserMessage(entry, {
            planModeEnabled: false,
            directory: '/workspace/pichamber',
        })).toBe(true);
        expect(isPendingUserMessagePaint(entry, {
            planModeEnabled: false,
            directory: '/workspace/pichamber',
        })).toBe(false);
        expect(normalizeUserDisplayParts(entry.parts, { directory: '/workspace/pichamber' })).toEqual([]);
        expect(normalizeUserDisplayParts(entry.parts, { directory: '/other' })[0]).toMatchObject({
            type: 'text',
            text: '/workspace/pichamber',
        });
    });

    test('hides a session-directory file chip and does not treat it as pending text', () => {
        const entry = userMessage([{ type: 'file', filename: '/workspace/pichamber' } as Part]);
        expect(isHiddenUserMessage(entry, {
            planModeEnabled: false,
            directory: '/workspace/pichamber',
        })).toBe(true);
        expect(isPendingUserMessagePaint(entry, {
            planModeEnabled: false,
            directory: '/workspace/pichamber',
        })).toBe(false);
    });

    test('hides the Goal plugin system preamble', () => {
        const entry = userMessage([{
            type: 'text',
            text: 'Goal mode is active. Complete this goal fully: say bye',
        } as Part]);
        expect(isHiddenUserMessage(entry, { planModeEnabled: false })).toBe(true);
        expect(isPendingUserMessagePaint(entry, { planModeEnabled: false })).toBe(false);
    });

    test('keeps a real user prompt visible', () => {
        const entry = userMessage([{ type: 'text', text: 'hello' } as Part]);
        expect(isHiddenUserMessage(entry, { planModeEnabled: false })).toBe(false);
        expect(isPendingUserMessagePaint(entry, { planModeEnabled: false })).toBe(false);
    });

    test('does not hold a skeleton for fully synthetic hidden nudges', () => {
        const entry = userMessage([{ type: 'text', text: 'ignore me', synthetic: true } as Part]);
        expect(isHiddenUserMessage(entry, { planModeEnabled: false })).toBe(true);
        expect(isPendingUserMessagePaint(entry, { planModeEnabled: false })).toBe(false);
    });

    test('reports pending paint when any user shell is still empty', () => {
        expect(hasPendingUserTranscriptPaint([
            userMessage([{ type: 'text', text: '' } as Part]),
        ], { planModeEnabled: false })).toBe(true);
        expect(hasPendingUserTranscriptPaint([
            userMessage([{ type: 'text', text: 'hello' } as Part]),
        ], { planModeEnabled: false })).toBe(false);
    });
});

describe('leftover /plan user bubbles', () => {
    beforeEach(() => {
        resetPiFeaturePluginsStore();
    });

    test('hides typed /plan while Feature Plugins have not loaded', () => {
        const entry = userMessage([{ type: 'text', text: '/plan' } as Part]);
        expect(isHiddenUserMessage(entry, { planModeEnabled: false })).toBe(true);
        expect(isPendingUserMessagePaint(entry, { planModeEnabled: false })).toBe(false);
    });

    test('hides a pasted /plan with whitespace or a trailing newline', () => {
        const entry = userMessage([{ type: 'text', text: ' /plan \n' } as Part]);
        expect(isHiddenUserMessage(entry, { planModeEnabled: false })).toBe(true);
    });

    test('hides /plan when the Plan slot is on', () => {
        const payload = emptyFeaturePluginsPayload();
        payload.slots.plan.installed = true;
        payload.slots.plan.enabled = true;
        applyFeaturePluginsPayload(payload);
        const entry = userMessage([{ type: 'text', text: '/plan start' } as Part]);
        expect(isHiddenUserMessage(entry, { planModeEnabled: false })).toBe(true);
    });

    test('keeps typed /plan as chat when the Plan slot is loaded and off', () => {
        applyFeaturePluginsPayload(emptyFeaturePluginsPayload());
        const entry = userMessage([{ type: 'text', text: '/plan' } as Part]);
        expect(isHiddenUserMessage(entry, { planModeEnabled: false })).toBe(false);
    });

    test('keeps an unknown slash as a normal chat bubble', () => {
        const entry = userMessage([{ type: 'text', text: '/not-a-real-cmd' } as Part]);
        expect(isHiddenUserMessage(entry, { planModeEnabled: false })).toBe(false);
    });
});

