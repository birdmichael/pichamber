import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Radio } from '@/components/ui/radio';
import { Icon } from '@/components/icon/Icon';
import { toast } from '@/components/ui';
import { cn } from '@/lib/utils';
import { isIMECompositionEvent } from '@/lib/ime';
import { useI18n } from '@/lib/i18n';
import { useUIStore } from '@/stores/useUIStore';
import {
  cancelPiExtensionUi,
  isFreeformOtherOption,
  isTypeSomethingOption,
  isPiExtensionUiNotFoundError,
  replyPiExtensionUi,
} from '@/sync/pi-extension-ui';
import {
  clearPiExtensionUiFocus,
  presentPiExtensionUiNotify,
  stashPiExtensionUiEditorText,
  usePiExtensionUiStore,
} from '@/sync/pi-extension-ui-store';
import type { PiExtensionUiPrompt } from '@/sync/pi-extension-ui';
import { localizePiPlanSelectOption, localizePiPlanSelectTitle } from '@/sync/pi-plan-locale';
import { PLAN_MODE_ENABLED_NOTIFY } from '@/sync/pi-session-plan';
import { refreshSessionPlan } from '@/sync/pi-session-plan-store';
import { QUESTION_CUSTOM_TEXTAREA_MIN_HEIGHT, getQuestionCustomTextareaHeight } from './questionTextareaSizing';
import { stopQuestionAnswerKeyBubble } from './questionAnswerFocus';
import { blurChatInput } from './composer/editor/dom';

interface PiExtensionPromptCardProps {
  prompt: PiExtensionUiPrompt;
}

const CustomAnswerTextarea = React.memo(function CustomAnswerTextarea({
  value,
  placeholder,
  disabled,
  onValueChange,
  onKeyDown,
}: {
  value: string;
  placeholder: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [localValue, setLocalValue] = React.useState(value);
  const [height, setHeight] = React.useState(QUESTION_CUSTOM_TEXTAREA_MIN_HEIGHT);
  const [isScrollable, setIsScrollable] = React.useState(false);

  React.useEffect(() => {
    setLocalValue(value);
  }, [value]);

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const nextHeight = getQuestionCustomTextareaHeight({
      scrollHeight: textarea.scrollHeight,
      currentHeight: height,
    });
    const nextScrollable = textarea.scrollHeight > (nextHeight ?? height);
    if (isScrollable !== nextScrollable) setIsScrollable(nextScrollable);
    if (nextHeight !== null) setHeight(nextHeight);
  }, [height, isScrollable, localValue]);

  React.useEffect(() => {
    if (disabled) return;
    textareaRef.current?.focus({ preventScroll: true });
  }, [disabled]);

  return (
    <textarea
      ref={textareaRef}
      data-question-answer="true"
      value={localValue}
      onChange={(event) => {
        const nextValue = event.target.value;
        setLocalValue(nextValue);
        onValueChange(nextValue);
      }}
      placeholder={placeholder}
      disabled={disabled}
      rows={2}
      onKeyDown={(event) => {
        stopQuestionAnswerKeyBubble(event);
        onKeyDown(event);
      }}
      onKeyUp={stopQuestionAnswerKeyBubble}
      onFocus={() => blurChatInput()}
      style={{ height }}
      className={cn(
        'w-full bg-transparent border border-border/30 focus:border-primary rounded px-2 py-1 outline-none typography-meta text-foreground placeholder:text-muted-foreground/50 transition-colors resize-none',
        isScrollable ? 'overflow-y-auto' : 'overflow-hidden',
      )}
      autoFocus
    />
  );
});

export const PiExtensionPromptCard: React.FC<PiExtensionPromptCardProps> = ({ prompt }) => {
  const { t } = useI18n();
  const isMobile = useUIStore((state) => state.isMobile);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const focusPromptId = usePiExtensionUiStore((state) => state.focusPromptId);
  const isFocusedPrompt = focusPromptId === prompt.id;
  const [isResponding, setIsResponding] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [customMode, setCustomMode] = React.useState(false);
  const customTextRef = React.useRef(prompt.prefill ?? '');
  const [customFilled, setCustomFilled] = React.useState(() => Boolean((prompt.prefill ?? '').trim()));

  React.useEffect(() => {
    if (!isFocusedPrompt) return;
    rootRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const timeout = window.setTimeout(() => clearPiExtensionUiFocus(prompt.id), 1200);
    return () => window.clearTimeout(timeout);
  }, [isFocusedPrompt, prompt.id]);

  const options = React.useMemo(() => prompt.options ?? [], [prompt.options]);
  const isMultiple = prompt.multiple;
  const isTextPrompt = prompt.kind === 'input' || prompt.kind === 'editor';
  const settled = prompt.status !== 'pending';

  const requiredSatisfied = React.useMemo(() => {
    if (isTextPrompt) return customFilled;
    if (customMode) return customFilled;
    return selected.length > 0;
  }, [customFilled, customMode, isTextPrompt, selected.length]);

  const handleToggleOption = React.useCallback((raw: string) => {
    if (isFreeformOtherOption(raw)) {
      setCustomMode(true);
      setSelected([]);
      return;
    }
    setCustomMode(false);
    setSelected((current) => {
      if (isMultiple) {
        return current.includes(raw) ? current.filter((item) => item !== raw) : [...current, raw];
      }
      return [raw];
    });
  }, [isMultiple]);

  const handleCustomValueChange = React.useCallback((value: string) => {
    customTextRef.current = value;
    setCustomFilled(value.trim().length > 0);
  }, []);

  const handleFailure = React.useCallback((error: unknown, failedKey: 'chat.piExtensionUi.submitFailed' | 'chat.piExtensionUi.dismissFailed') => {
    if (isPiExtensionUiNotFoundError(error)) {
      toast.info(t('chat.piExtensionUi.noLongerPending'));
      return;
    }
    toast.error(t(failedKey), { description: t('chat.piExtensionUi.tryAgain') });
  }, [t]);

  const handleConfirm = React.useCallback(async () => {
    if (!requiredSatisfied || settled) return;
    setIsResponding(true);
    try {
      if (isTextPrompt) {
        await replyPiExtensionUi(prompt.sessionID, prompt.id, customTextRef.current.trim());
        return;
      }
      if (customMode) {
        const other = options.find((option) => isFreeformOtherOption(option)) ?? options.at(-1);
        if (!other) return;
        stashPiExtensionUiEditorText(prompt.sessionID, customTextRef.current.trim());
        await replyPiExtensionUi(prompt.sessionID, prompt.id, other);
        return;
      }
      const value = isMultiple ? selected : selected[0];
      await replyPiExtensionUi(prompt.sessionID, prompt.id, value);
      const started = (Array.isArray(value) ? value : [value]).some((option) => (
        /start plan mode/i.test(String(option ?? ''))
      ));
      if (started) {
        presentPiExtensionUiNotify({ message: PLAN_MODE_ENABLED_NOTIFY, level: 'info' });
      }
      void refreshSessionPlan(prompt.sessionID);
      window.setTimeout(() => {
        void refreshSessionPlan(prompt.sessionID);
      }, 400);
    } catch (error) {
      handleFailure(error, 'chat.piExtensionUi.submitFailed');
    } finally {
      setIsResponding(false);
    }
  }, [customMode, handleFailure, isMultiple, isTextPrompt, options, prompt.id, prompt.sessionID, requiredSatisfied, selected, settled]);

  const handleDismiss = React.useCallback(async () => {
    if (settled) return;
    setIsResponding(true);
    try {
      await cancelPiExtensionUi(prompt.sessionID, prompt.id);
    } catch (error) {
      handleFailure(error, 'chat.piExtensionUi.dismissFailed');
    } finally {
      setIsResponding(false);
    }
  }, [handleFailure, prompt.id, prompt.sessionID, settled]);

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isIMECompositionEvent(event)) return;
    if (event.key === 'Enter' && !event.shiftKey && (!isMobile || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (requiredSatisfied) void handleConfirm();
    }
  }, [handleConfirm, isMobile, requiredSatisfied]);

  const answerLabel = React.useMemo(() => {
    if (prompt.status === 'cancelled') return t('chat.piExtensionUi.cancelled');
    if (typeof prompt.value === 'string' && prompt.value.trim()) return prompt.value;
    if (Array.isArray(prompt.value) && prompt.value.length > 0) return prompt.value.join(', ');
    if (customMode) return customTextRef.current.trim() || t('chat.piExtensionUi.answered');
    if (selected.length > 0) return selected.map((item) => localizePiPlanSelectOption(item, t).label).join(', ');
    return t('chat.piExtensionUi.answered');
  }, [customMode, prompt.status, prompt.value, selected, t]);

  return (
    <div
      ref={rootRef}
      data-pi-ui-prompt={prompt.id}
      className={cn(
        'group w-full pt-0 pb-2',
        isFocusedPrompt ? 'ring-2 ring-primary/40 rounded-xl' : null,
      )}
    >
      <div className="chat-column">
        <div className="-mt-1 border border-border/30 rounded-xl bg-muted/10">
          <div className="px-2 py-1.5 border-b border-border/20">
            <div className="flex items-center gap-2">
              <Icon name="question" className="h-3.5 w-3.5 text-primary" />
              <span className="typography-meta font-medium text-muted-foreground">
                {t('chat.piExtensionUi.inputNeeded')}
              </span>
              {settled ? (
                <span className="ml-auto typography-micro font-medium text-foreground/70 px-1.5 py-0.5 rounded bg-muted/30 border border-border/20">
                  {prompt.status === 'cancelled' ? t('chat.piExtensionUi.cancelled') : t('chat.piExtensionUi.answered')}
                </span>
              ) : null}
            </div>
          </div>

          <div className="px-2 py-2">
            {prompt.title ? (
              <div className="typography-meta font-medium text-foreground mb-1.5">{localizePiPlanSelectTitle(prompt.title, t)}</div>
            ) : (
              <div className="typography-meta font-medium text-foreground mb-1.5">{t('chat.piExtensionUi.questionFallback')}</div>
            )}
            {prompt.message && prompt.kind !== 'select' ? (
              <div className="typography-micro text-muted-foreground mb-1.5">{prompt.message}</div>
            ) : null}

            {settled ? (
              <div className="typography-meta text-foreground">{answerLabel}</div>
            ) : isTextPrompt ? (
              <CustomAnswerTextarea
                value={customTextRef.current}
                onValueChange={handleCustomValueChange}
                placeholder={prompt.placeholder || t('chat.piExtensionUi.yourAnswer')}
                disabled={isResponding}
                onKeyDown={handleKeyDown}
              />
            ) : (
              <>
                {isMultiple ? (
                  <div className="typography-micro text-muted-foreground mb-1.5">{t('chat.piExtensionUi.selectMultiple')}</div>
                ) : null}
                <div className="space-y-0.5">
                  {options.map((option, index) => {
                    const other = isFreeformOtherOption(option);
                    const parsed = localizePiPlanSelectOption(option, t);
                    const isSelected = other ? customMode : selected.includes(option);
                    return (
                      <button
                        key={`${index}:${option}`}
                        type="button"
                        onClick={() => handleToggleOption(option)}
                        disabled={isResponding}
                        className={cn(
                          'w-full px-1.5 py-1 text-left rounded transition-colors',
                          'hover:bg-interactive-hover/30',
                          isSelected ? 'bg-interactive-selection/20' : null,
                          isResponding ? 'opacity-60 cursor-not-allowed' : null,
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <div className="mt-0.5 shrink-0">
                            {other ? (
                              <Icon name="edit" className={cn('h-3.5 w-3.5', isSelected ? 'text-primary' : 'text-muted-foreground/50')} />
                            ) : isMultiple ? (
                              <Checkbox checked={isSelected} onChange={() => handleToggleOption(option)} disabled={isResponding} />
                            ) : (
                              <Radio checked={isSelected} onChange={() => handleToggleOption(option)} disabled={isResponding} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className={cn('typography-meta break-all', isSelected ? 'text-foreground font-medium' : 'text-foreground/80')}>
                              {other && !isTypeSomethingOption(option) ? t('chat.piExtensionUi.other') : parsed.label}
                            </span>
                            {!other && parsed.description ? (
                              <div className="typography-micro text-muted-foreground break-words">{parsed.description}</div>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {customMode ? (
                    <div className="pl-6 pr-1 pt-0.5">
                      <CustomAnswerTextarea
                        value={customTextRef.current}
                        onValueChange={handleCustomValueChange}
                        placeholder={t('chat.piExtensionUi.yourAnswer')}
                        disabled={isResponding}
                        onKeyDown={handleKeyDown}
                      />
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>

          {settled ? null : (
            <div className="px-2 pb-1.5 pt-1 flex items-center gap-1.5 border-t border-border/20">
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={isResponding || !requiredSatisfied}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 typography-meta font-medium rounded transition-colors',
                  'bg-[rgb(var(--status-success)/0.1)] text-[var(--status-success)] hover:bg-[rgb(var(--status-success)/0.2)]',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                <Icon name="check" className="h-3 w-3" />
                {t('chat.piExtensionUi.submit')}
              </button>
              {!requiredSatisfied && !isTextPrompt && !customMode ? (
                <span className="typography-micro text-muted-foreground">
                  {t('chat.piExtensionUi.chooseOption')}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void handleDismiss()}
                disabled={isResponding}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 typography-meta font-medium rounded transition-colors',
                  'bg-[rgb(var(--status-error)/0.1)] text-[var(--status-error)] hover:bg-[rgb(var(--status-error)/0.2)]',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                <Icon name="close" className="h-3 w-3" />
                {t('chat.piExtensionUi.dismiss')}
              </button>
              {isResponding ? (
                <div className="ml-auto">
                  <div className="animate-spin h-3 w-3 border border-primary border-t-transparent rounded-full" />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
