/**
 * Busy-session composer send: map Settings Follow-up behavior onto Pi
 * steer / followUp, or the leftover OpenCode local queue.
 *
 * Pi Queue is session.followUp (POST immediately). It must not land in
 * OpenCode QueuedMessageChips. Explicit delivery must survive even if the
 * UI still thinks the session is idle — prompt_async / the host decide.
 */

export type FollowUpBehavior = 'steer' | 'queue';
export type ComposerSessionPhase = 'idle' | 'busy' | 'retry';
export type PromptDelivery = 'steer' | 'followUp';
export type BusyComposerSendAction = 'followUp' | 'steer' | 'localQueue' | 'submit';

export type BusyComposerSend = {
    action: BusyComposerSendAction;
    delivery?: PromptDelivery;
};

export const resolveBusyComposerSend = (input: {
    followUpBehavior: FollowUpBehavior;
    isPiKernel: boolean;
    canQueue: boolean;
    isCtrlEnter?: boolean;
}): BusyComposerSend => {
    // Ctrl+Enter while busy defaults to steer via handleSubmit() with no
    // delivery (Pi then defaults to steer). Do not expand that here.
    if (input.isCtrlEnter || !input.canQueue) {
        return { action: 'submit' };
    }
    if (input.followUpBehavior === 'queue') {
        if (input.isPiKernel) {
            return { action: 'followUp', delivery: 'followUp' };
        }
        return { action: 'localQueue' };
    }
    return { action: 'steer', delivery: 'steer' };
};

/**
 * Keep an explicit steer/followUp on the wire. The previous check required
 * sessionPhase !== 'idle', which dropped delivery when leftover-busy logic
 * idled the UI during a live Pi tool run — both modes became a no-op prompt.
 */
export const resolveSubmitDelivery = (input: {
    requested?: PromptDelivery | string;
    isPiKernel: boolean;
    sessionPhase: ComposerSessionPhase | string;
    queuedOnly?: boolean;
}): PromptDelivery | undefined => {
    if (input.requested === 'steer' || input.requested === 'followUp') {
        return input.requested;
    }
    if (input.isPiKernel && input.sessionPhase !== 'idle' && !input.queuedOnly) {
        return 'steer';
    }
    return undefined;
};
