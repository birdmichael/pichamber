/**
 * Per-session draft persistence for the composer.
 *
 * A draft belongs to a (runtime, directory, session) identity. Switching any
 * of those saves the outgoing draft and restores the incoming one, so moving
 * between sessions never loses typed text and never leaks it into the wrong
 * conversation.
 *
 * Writes are debounced while typing but forced at every edge where the page
 * may stop running — tab hidden, frozen, unloading, unmounting — because a
 * pending timer is not a saved draft.
 */

import React from 'react';

import {
    getChatDraftIdentityKey,
    readChatDraft,
    subscribeChatDraftDeletion,
    writeChatDraft,
    type ChatDraftIdentity,
} from '@/lib/chatDraftPersistence';

export type ComposerIdentitySwitchResult = {
    changed: boolean;
    text: string;
    confirmedMentions: Set<string>;
};

/**
 * Save the outgoing composer text under `previous` and restore `next`.
 * A no-op when the identity key is unchanged, so a remount with the same
 * session does not rewrite the live draft onto itself.
 */
export function applyComposerIdentitySwitch(options: {
    previous: ChatDraftIdentity | null;
    next: ChatDraftIdentity | null;
    currentText: string;
    currentMentions?: Iterable<string>;
    persistEnabled: boolean;
    /**
     * Chat→project New session: keep the live composer empty without writing
     * empty onto the destination identity (preserves a real project untitled).
     */
    emptyIncoming?: boolean;
}): ComposerIdentitySwitchResult {
    const previousKey = options.previous ? getChatDraftIdentityKey(options.previous) : null;
    const nextKey = options.next ? getChatDraftIdentityKey(options.next) : null;

    const collectActiveMentions = (): Set<string> => {
        const activeMentions = new Set<string>();
        for (const mention of options.currentMentions ?? []) {
            if (options.currentText.includes(`@${mention}`)) activeMentions.add(mention);
        }
        return activeMentions;
    };

    if (options.emptyIncoming) {
        if (options.persistEnabled && previousKey !== nextKey) {
            writeChatDraft(options.previous, options.currentText, collectActiveMentions());
        }
        // Do not read or write the destination — leftover `~` storage must not
        // appear live, and an empty write must not wipe a real project draft.
        const shouldChange = previousKey !== nextKey || Boolean(options.currentText);
        return {
            changed: shouldChange,
            text: '',
            confirmedMentions: new Set(),
        };
    }

    if (previousKey === nextKey) {
        return {
            changed: false,
            text: options.currentText,
            confirmedMentions: new Set(options.currentMentions ?? []),
        };
    }

    if (!options.persistEnabled) {
        return { changed: true, text: '', confirmedMentions: new Set() };
    }

    const activeMentions = collectActiveMentions();
    writeChatDraft(options.previous, options.currentText, activeMentions);
    const restored = readChatDraft(options.next);
    return { changed: true, text: restored.text, confirmedMentions: restored.confirmedMentions };
}

const PERSIST_DEBOUNCE_MS = 500;

/**
 * Identifies a stored draft's content. Comparing signatures lets a repeated
 * save of unchanged text skip the write entirely.
 */
function draftSignature(text: string, confirmedMentions: Iterable<string>): string {
    // NUL separates the fields: no draft text can contain it, so two different
    // (text, mentions) pairs can never produce the same signature.
    return `${text}\u0000${[...confirmedMentions].sort().join('\u0000')}`;
}

export interface ComposerDraftOptions {
    /** Current composer text. */
    message: string;
    /** Latest text without waiting for a render, for flush-on-unload paths. */
    messageRef: React.RefObject<string>;
    setMessage: (text: string) => void;
    /**
     * Mention paths the user confirmed through the picker. Mutated here:
     * mentions no longer present in the text are dropped before saving.
     */
    confirmedMentionsRef: React.RefObject<Set<string>>;
    /** The draft this composer currently belongs to. */
    identity: ChatDraftIdentity | null;
    /** User setting: when off, drafts are discarded rather than stored. */
    persistEnabled: boolean;
    /** The draft restored on mount, if any. */
    initialDraft: { text: string; identity: ChatDraftIdentity | null };
    /** Called when the composer switches to a different draft identity. */
    onIdentityChange?: () => void;
    /** Called after a non-empty draft is restored, to select its text. */
    onDraftRestored?: () => void;
    /**
     * When set, an identity switch saves the outgoing draft then loads empty
     * into the live composer without persisting empty onto the destination.
     */
    emptyIncomingComposer?: boolean;
}

export interface ComposerDraftControls {
    /**
     * Write a draft now, bypassing the debounce. Used on submit, where the
     * cleared composer must be stored before the send resolves.
     */
    persistNow: (identity: ChatDraftIdentity | null, draft: string) => void;
}

export function useComposerDraft(options: ComposerDraftOptions): ComposerDraftControls {
    const {
        message,
        messageRef,
        setMessage,
        confirmedMentionsRef,
        identity,
        persistEnabled,
        initialDraft,
        onIdentityChange,
        onDraftRestored,
        emptyIncomingComposer = false,
    } = options;

    const persistTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const skipNextPersistRef = React.useRef(false);
    const lastPersistedRef = React.useRef<Map<string, string>>(new Map());
    // Owns the text in `messageRef`. Updated only after a switch restores the
    // incoming draft, so unmount/visibility flush cannot write the outgoing
    // text onto the incoming session.
    const currentIdentityRef = React.useRef<ChatDraftIdentity | null>(initialDraft.identity);

    // Callbacks reach the effects through a ref so a caller passing inline
    // functions does not re-run the persistence effects on every render.
    const callbacksRef = React.useRef({ onIdentityChange, onDraftRestored });
    callbacksRef.current = { onIdentityChange, onDraftRestored };

    const persistNow = React.useCallback((target: ChatDraftIdentity | null, draft: string) => {
        if (!target) return;
        const key = getChatDraftIdentityKey(target);

        // Only keep confirmed mentions the draft still contains: a mention the
        // user deleted must not resurrect as a file reference on restore.
        const activeMentions = new Set<string>();
        for (const mention of confirmedMentionsRef.current) {
            if (draft.includes(`@${mention}`)) activeMentions.add(mention);
        }
        confirmedMentionsRef.current = activeMentions;

        const signature = draftSignature(draft, activeMentions);
        const isLiveIdentity = Boolean(
            currentIdentityRef.current
            && getChatDraftIdentityKey(currentIdentityRef.current) === key
        );
        // Submit clears the draft before the minted session remounts the
        // composer. Keep the live ref aligned so identity switch cannot write
        // the sent text back onto New session.
        if (isLiveIdentity) messageRef.current = draft;
        if (lastPersistedRef.current.get(key) === signature) return;

        writeChatDraft(target, draft, activeMentions);
        lastPersistedRef.current.set(key, signature);
    }, [confirmedMentionsRef, messageRef]);

    const clearPending = React.useCallback(() => {
        if (!persistTimerRef.current) return;
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
    }, []);

    // Mount: a restored draft is selected so typing replaces it; with the
    // setting off it is discarded instead of silently kept.
    const handledInitialRef = React.useRef(false);
    React.useEffect(() => {
        if (handledInitialRef.current) return;
        handledInitialRef.current = true;
        if (!initialDraft.text) return;

        if (!persistEnabled) {
            setMessage('');
            writeChatDraft(initialDraft.identity, '', []);
            return;
        }
        requestAnimationFrame(() => callbacksRef.current.onDraftRestored?.());
        // Runs once; the initial draft is captured at mount by design.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [persistEnabled]);

    // Identity switch: save the outgoing draft, load the incoming one.
    const previousIdentityRef = React.useRef<ChatDraftIdentity | null>(initialDraft.identity);
    React.useEffect(() => {
        const previous = previousIdentityRef.current;
        const switched = applyComposerIdentitySwitch({
            previous,
            next: identity,
            currentText: messageRef.current,
            currentMentions: confirmedMentionsRef.current,
            persistEnabled,
            emptyIncoming: emptyIncomingComposer,
        });
        if (!switched.changed) {
            currentIdentityRef.current = identity;
            return;
        }

        previousIdentityRef.current = identity;
        callbacksRef.current.onIdentityChange?.();
        clearPending();
        // The incoming draft is being written into state right now; the
        // debounced effect must not immediately write it back out.
        skipNextPersistRef.current = true;

        if (previous && persistEnabled) {
            lastPersistedRef.current.set(
                getChatDraftIdentityKey(previous),
                draftSignature(messageRef.current, confirmedMentionsRef.current),
            );
        }
        messageRef.current = switched.text;
        setMessage(switched.text);
        confirmedMentionsRef.current = switched.confirmedMentions;
        currentIdentityRef.current = identity;
        if (identity && persistEnabled) {
            lastPersistedRef.current.set(
                getChatDraftIdentityKey(identity),
                draftSignature(switched.text, switched.confirmedMentions),
            );
        }
        if (switched.text) {
            requestAnimationFrame(() => callbacksRef.current.onDraftRestored?.());
        }
    }, [clearPending, confirmedMentionsRef, emptyIncomingComposer, identity, messageRef, persistEnabled, setMessage]);

    // A draft deleted elsewhere (session deleted, drafts cleared) clears the
    // composer if it is the one on screen.
    React.useEffect(() => subscribeChatDraftDeletion((deleted) => {
        const deletedKey = getChatDraftIdentityKey(deleted);
        // Record the empty signature so a queued write does not resurrect it.
        lastPersistedRef.current.set(deletedKey, draftSignature('', []));

        const current = currentIdentityRef.current;
        if (!current || getChatDraftIdentityKey(current) !== deletedKey) return;

        clearPending();
        skipNextPersistRef.current = true;
        messageRef.current = '';
        confirmedMentionsRef.current = new Set();
        setMessage('');
    }), [clearPending, confirmedMentionsRef, messageRef, setMessage]);

    // Debounced write while typing.
    React.useEffect(() => {
        if (!persistEnabled) {
            clearPending();
            persistNow(identity, '');
            return;
        }

        if (skipNextPersistRef.current) {
            skipNextPersistRef.current = false;
            return;
        }

        clearPending();
        const draftSnapshot = message;
        const identitySnapshot = identity;
        persistTimerRef.current = setTimeout(() => {
            persistTimerRef.current = null;
            persistNow(identitySnapshot, draftSnapshot);
        }, PERSIST_DEBOUNCE_MS);

        return clearPending;
    }, [clearPending, identity, message, persistEnabled, persistNow]);

    // Force a write wherever the page may stop running before the timer fires.
    React.useEffect(() => {
        const flush = () => {
            clearPending();
            if (persistEnabled) persistNow(currentIdentityRef.current, messageRef.current);
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') flush();
        };

        document.addEventListener('visibilitychange', onVisibilityChange);
        document.addEventListener('freeze', flush);
        window.addEventListener('pagehide', flush);
        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            document.removeEventListener('freeze', flush);
            window.removeEventListener('pagehide', flush);
            flush();
        };
    }, [clearPending, messageRef, persistEnabled, persistNow]);

    return { persistNow };
}
