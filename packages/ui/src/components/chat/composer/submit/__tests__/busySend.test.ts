import { describe, expect, test } from 'bun:test';

import { resolveBusyComposerSend, resolveSubmitDelivery } from '../busySend';

describe('resolveBusyComposerSend', () => {
    test('Pi Queue busy Enter posts followUp instead of a local queue', () => {
        expect(resolveBusyComposerSend({
            followUpBehavior: 'queue',
            isPiKernel: true,
            canQueue: true,
        })).toEqual({ action: 'followUp', delivery: 'followUp' });
    });

    test('Pi Steer busy Enter posts steer', () => {
        expect(resolveBusyComposerSend({
            followUpBehavior: 'steer',
            isPiKernel: true,
            canQueue: true,
        })).toEqual({ action: 'steer', delivery: 'steer' });
    });

    test('OpenCode Queue busy Enter keeps the local queue', () => {
        expect(resolveBusyComposerSend({
            followUpBehavior: 'queue',
            isPiKernel: false,
            canQueue: true,
        })).toEqual({ action: 'localQueue' });
    });

    test('idle or empty send is a normal submit', () => {
        expect(resolveBusyComposerSend({
            followUpBehavior: 'queue',
            isPiKernel: true,
            canQueue: false,
        })).toEqual({ action: 'submit' });
    });

    test('Ctrl+Enter while Queue is busy is a normal submit (host defaults to steer)', () => {
        expect(resolveBusyComposerSend({
            followUpBehavior: 'queue',
            isPiKernel: true,
            canQueue: true,
            isCtrlEnter: true,
        })).toEqual({ action: 'submit' });
    });
});

describe('resolveSubmitDelivery', () => {
    test('keeps explicit followUp even when the UI still reports idle', () => {
        expect(resolveSubmitDelivery({
            requested: 'followUp',
            isPiKernel: true,
            sessionPhase: 'idle',
        })).toBe('followUp');
    });

    test('keeps explicit steer even when the UI still reports idle', () => {
        expect(resolveSubmitDelivery({
            requested: 'steer',
            isPiKernel: true,
            sessionPhase: 'idle',
        })).toBe('steer');
    });

    test('busy Pi send without delivery defaults to steer', () => {
        expect(resolveSubmitDelivery({
            isPiKernel: true,
            sessionPhase: 'busy',
        })).toBe('steer');
    });

    test('idle Pi send without delivery is a normal prompt', () => {
        expect(resolveSubmitDelivery({
            isPiKernel: true,
            sessionPhase: 'idle',
        })).toBeUndefined();
    });
});
