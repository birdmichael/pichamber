import { describe, expect, test } from 'bun:test';

import {
    areDraftPresetChipsVisible,
    BUILTIN_STARTERS,
    DEFAULT_GLOBAL_STARTERS,
    getBuiltInStarter,
    isPichamberStarterSlashCommand,
    PICHAMBER_STARTER_SLASH_COMMANDS,
    resolveDraftGoalStarterClick,
    resolveDraftPlanStarterClick,
    shouldOfferLiveCommandAsStarter,
    shouldShowDesktopDraftWelcomeChrome,
} from './draftStarters';

describe('empty-session welcome chips', () => {
    test('Pi still shows catch-up and plan-feature chips', () => {
        expect(areDraftPresetChipsVisible({ visible: true, isPiKernel: true })).toBe(true);
        expect(areDraftPresetChipsVisible({ visible: false, isPiKernel: true })).toBe(false);
        const names = DEFAULT_GLOBAL_STARTERS.map((starter) => starter.name);
        expect(names).toContain('catch-up');
        expect(names).toContain('plan-feature');
        expect(getBuiltInStarter('catch-up')?.command).toBe('/catch-up');
        expect(getBuiltInStarter('plan-feature')?.command).toBe('/plan-feature');
    });

    test('desktop welcome chrome is the same for New session and an empty existing session', () => {
        const desktop = {
            isDesktopExpanded: false,
            isMobile: false,
            isVSCode: false,
            isMiniChatSurface: false,
        };
        expect(shouldShowDesktopDraftWelcomeChrome({
            ...desktop,
            newSessionDraftOpen: true,
            emptySessionWelcome: false,
        })).toBe(true);
        expect(shouldShowDesktopDraftWelcomeChrome({
            ...desktop,
            newSessionDraftOpen: false,
            emptySessionWelcome: true,
        })).toBe(true);
        expect(shouldShowDesktopDraftWelcomeChrome({
            ...desktop,
            newSessionDraftOpen: false,
            emptySessionWelcome: false,
        })).toBe(false);
        expect(shouldShowDesktopDraftWelcomeChrome({
            ...desktop,
            isMobile: true,
            newSessionDraftOpen: true,
            emptySessionWelcome: true,
        })).toBe(false);
    });

    test('every built-in starter is a Pichamber slash command', () => {
        for (const starter of BUILTIN_STARTERS) {
            const slashName = starter.command.replace(/^\//, '');
            expect(PICHAMBER_STARTER_SLASH_COMMANDS.has(slashName)).toBe(true);
            expect(isPichamberStarterSlashCommand(slashName)).toBe(true);
        }
        expect(isPichamberStarterSlashCommand('init')).toBe(false);
        expect(isPichamberStarterSlashCommand('handoff-review')).toBe(false);
    });
});

describe('live Plan starter', () => {
    test('does not offer /plan /run /goal as pin-and-send chips', () => {
        expect(shouldOfferLiveCommandAsStarter('plan')).toBe(false);
        expect(shouldOfferLiveCommandAsStarter('run')).toBe(false);
        expect(shouldOfferLiveCommandAsStarter('goal')).toBe(false);
        expect(shouldOfferLiveCommandAsStarter('plan-feature')).toBe(false);
        expect(shouldOfferLiveCommandAsStarter('explore')).toBe(false);
        expect(shouldOfferLiveCommandAsStarter('simplify-code')).toBe(true);
    });

    test('a /plan chip on a new-session draft only switches Plan mode', () => {
        expect(resolveDraftPlanStarterClick({
            submitText: '/plan',
            draftOpen: true,
            composerText: '',
        })).toEqual({ kind: 'draft-plan', sendText: null });
        expect(resolveDraftPlanStarterClick({
            submitText: '/plan',
            draftOpen: true,
            composerText: '  outline the repo  ',
        })).toEqual({ kind: 'draft-plan', sendText: 'outline the repo' });
        expect(resolveDraftPlanStarterClick({
            submitText: '/plan',
            draftOpen: true,
            composerText: '/plan',
        })).toEqual({ kind: 'draft-plan', sendText: null });
        expect(resolveDraftPlanStarterClick({
            submitText: '/plan',
            draftOpen: true,
            composerText: '/plan outline the repo',
        })).toEqual({ kind: 'draft-plan', sendText: 'outline the repo' });
        expect(resolveDraftPlanStarterClick({
            submitText: '/plan-feature',
            draftOpen: true,
            composerText: '',
        })).toEqual({ kind: 'submit' });
        expect(resolveDraftPlanStarterClick({
            submitText: '/plan',
            draftOpen: false,
            composerText: '',
        })).toEqual({ kind: 'submit' });
        expect(resolveDraftPlanStarterClick({
            submitText: 'Plan a one-line hello world. Do not write code yet.',
            draftOpen: true,
            composerText: 'Plan a one-line hello world. Do not write code yet.',
        })).toEqual({ kind: 'submit' });
    });
});

describe('Craft a Goal starter', () => {
    test('opens the Goal dialog and does not send leftover composer text', () => {
        expect(resolveDraftGoalStarterClick({
            submitText: '/craft-goal',
            composerText: '',
        })).toEqual({ kind: 'draft-goal', seedText: '' });
        expect(resolveDraftGoalStarterClick({
            submitText: '/craft-goal',
            composerText: 'projectless-draft',
        })).toEqual({ kind: 'draft-goal', seedText: 'projectless-draft' });
        expect(resolveDraftGoalStarterClick({
            submitText: '/craft-goal',
            composerText: '/craft-goal leftover',
        })).toEqual({ kind: 'draft-goal', seedText: 'leftover' });
        expect(resolveDraftGoalStarterClick({
            submitText: '/schedule-task',
            composerText: 'projectless-draft',
        })).toEqual({ kind: 'submit' });
    });
});

