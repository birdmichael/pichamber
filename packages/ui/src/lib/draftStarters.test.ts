import { describe, expect, test } from 'bun:test';

import {
    areDraftPresetChipsVisible,
    BUILTIN_STARTERS,
    DEFAULT_GLOBAL_STARTERS,
    getBuiltInStarter,
    isPichamberStarterSlashCommand,
    PICHAMBER_STARTER_SLASH_COMMANDS,
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
