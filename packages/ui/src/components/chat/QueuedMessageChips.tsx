import React, { memo } from 'react';
import {
    DndContext,
    MouseSensor,
    TouchSensor,
    useSensor,
    useSensors,
    closestCenter,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { createMessageQueueTarget, getMessageQueueKey, useMessageQueueStore, type MessageQueueTarget, type QueuedMessage } from '@/stores/messageQueueStore';
import { useInlineCommentDraftStore } from '@/stores/useInlineCommentDraftStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useInputStore } from '@/sync/input-store';
import { useI18n } from '@/lib/i18n';
import { Icon } from "@/components/icon/Icon";
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getQueuedMessagePreview } from '@/lib/messages/queuedMessagePreview';
import { useMobileAutocompleteMaxHeight } from './useMobileAutocompleteMaxHeight';

interface QueuedMessageChipProps {
    message: QueuedMessage;
    target: MessageQueueTarget;
    onEdit: (message: QueuedMessage) => void;
    onSend: (message: QueuedMessage) => void;
}

const QueuedMessageChip = memo(({ message, target, onEdit, onSend }: QueuedMessageChipProps) => {
    const { t } = useI18n();
    const removeFromQueue = useMessageQueueStore((state) => state.removeFromQueue);
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: message.id });

    const firstLine = getQueuedMessagePreview(message);

    const attachmentCount = message.attachments?.length ?? 0;

    return (
        <div
            ref={setNodeRef}
            // Translate only (no scaleX/scaleY) so the lifted row keeps its size.
            style={{ transform: CSS.Translate.toString(transform), transition }}
            className={cn('flex min-w-0 items-center gap-2 py-1', isDragging && 'z-10 opacity-60')}
        >
            <button
                type="button"
                {...attributes}
                {...listeners}
                className="flex flex-shrink-0 cursor-grab touch-none select-none items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
                aria-label={t('chat.queuedMessage.reorderAria')}
            >
                <Icon name="draggable" className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="min-w-0 flex-1 truncate typography-ui-label text-foreground">
                {firstLine || t('chat.queuedMessage.empty')}
                {attachmentCount > 0 && (
                    <span className="ml-1 text-muted-foreground">{t('chat.queuedMessage.attachments', { count: attachmentCount })}</span>
                )}
            </span>
            <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={() => onEdit(message)}
            >
                <Icon name="edit" className="h-3 w-3" aria-hidden="true" />
                {t('chat.queuedMessage.edit')}
            </Button>
            <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={() => onSend(message)}
            >
                <Icon name="send-plane" className="h-3 w-3" aria-hidden="true" />
                {t('chat.queuedMessage.send')}
            </Button>
            <button
                type="button"
                onClick={() => removeFromQueue(target, message.id)}
                className="flex items-center justify-center h-6 w-6 flex-shrink-0 hover:bg-[var(--interactive-hover)] rounded-full transition-colors"
                aria-label={t('chat.queuedMessage.removeAria')}
            >
                <Icon name="close" className="h-4 w-4 text-muted-foreground" />
            </button>
        </div>
    );
});

QueuedMessageChip.displayName = 'QueuedMessageChip';

interface QueuedMessageChipsProps {
    onEditMessage: (content: string, attachments?: QueuedMessage['attachments']) => void;
    onSendMessage: (messageId: string) => void;
}

const EMPTY_QUEUE: QueuedMessage[] = [];

export const QueuedMessageChips = memo(({ onEditMessage, onSendMessage }: QueuedMessageChipsProps) => {
    const { t } = useI18n();
    const [collapsed, setCollapsed] = React.useState(true);
    const bodyId = React.useId();
    const bodyRef = React.useRef<HTMLDivElement | null>(null);
    const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
    // Must use the same resolution the composer used to build the queue key —
    // reading currentSessionDirectory raw can key the chips to a different
    // directory than the one the messages were queued under.
    const currentSessionDirectory = useSessionUIStore(
        React.useCallback(
            (state) => (currentSessionId ? state.getDirectoryForSession(currentSessionId) : null),
            [currentSessionId],
        ),
    );
    const target = currentSessionId ? createMessageQueueTarget(currentSessionId, currentSessionDirectory) : null;
    const queueKey = target ? getMessageQueueKey(target) : null;
    const queuedMessages = useMessageQueueStore(
        React.useCallback(
            (state) => {
                if (!queueKey) return EMPTY_QUEUE;
                return state.queuedMessages[queueKey] ?? EMPTY_QUEUE;
            },
            [queueKey]
        )
    );
    const popToInput = useMessageQueueStore((state) => state.popToInput);
    const reorderQueue = useMessageQueueStore((state) => state.reorderQueue);
    const availableMaxHeight = useMobileAutocompleteMaxHeight(bodyRef, !collapsed && queuedMessages.length > 0);

    const sensors = useSensors(
        // Desktop: drag after a small move so other clicks still register.
        useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
        // Touch: long-press to drag (tap still hits buttons, swipe scrolls).
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    );

    const handleDragEnd = React.useCallback((event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id || !target) return;
        reorderQueue(target, String(active.id), String(over.id));
    }, [target, reorderQueue]);

    const handleEdit = React.useCallback((message: QueuedMessage) => {
        if (!target) return;
        
        const popped = popToInput(target, message.id);
        if (popped) {
            if (popped.attachments && popped.attachments.length > 0) {
                const currentAttachments = useInputStore.getState().attachedFiles;
                useInputStore.getState().setAttachedFiles([...currentAttachments, ...popped.attachments]);
            }
            if (popped.contextDrafts && popped.contextDrafts.length > 0) {
                useInlineCommentDraftStore.getState().restoreDrafts(
                    { directory: target.directory, sessionKey: target.sessionId },
                    popped.contextDrafts,
                );
            }
            onEditMessage(popped.content, popped.attachments);
        }
    }, [target, popToInput, onEditMessage]);

    const handleSend = React.useCallback((message: QueuedMessage) => {
        onSendMessage(message.id);
    }, [onSendMessage]);

    if (queuedMessages.length === 0 || !target) {
        return null;
    }

    return (
        <div className="pb-2 w-full px-1">
            <div className="rounded-xl border border-border/60 bg-[var(--surface-elevated)] text-[var(--surface-elevated-foreground)] shadow-sm overflow-hidden">
                <div className="flex w-full items-center gap-2 px-3 py-2 text-left">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCollapsed((value) => !value)}
                        aria-expanded={!collapsed}
                        aria-controls={collapsed ? undefined : bodyId}
                        className="min-w-0 flex-1 shrink justify-start px-0 normal-case text-muted-foreground hover:!bg-transparent hover:text-foreground has-[>svg]:px-0"
                    >
                        <Icon name="time" className="size-3.5 shrink-0" aria-hidden="true" />
                        <Icon name={collapsed ? 'arrow-up-s' : 'arrow-down-s'} className="size-4 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 truncate typography-ui-label font-medium text-foreground">
                            {t('chat.queuedMessage.title')} {queuedMessages.length}
                        </span>
                    </Button>
                </div>
                {!collapsed && (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={queuedMessages.map((m) => m.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            <div
                                ref={bodyRef}
                                id={bodyId}
                                className="px-3 pb-3 flex flex-col gap-1.5 max-h-[10.5rem] overflow-y-auto overscroll-contain"
                                style={availableMaxHeight === undefined ? undefined : { maxHeight: Math.max(72, availableMaxHeight - 48) }}
                            >
                                {queuedMessages.map((message) => (
                                    <QueuedMessageChip
                                        key={message.id}
                                        message={message}
                                        target={target}
                                        onEdit={handleEdit}
                                        onSend={handleSend}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                )}
            </div>
        </div>
    );
});

QueuedMessageChips.displayName = 'QueuedMessageChips';
