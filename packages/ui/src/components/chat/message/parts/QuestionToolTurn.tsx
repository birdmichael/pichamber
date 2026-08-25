import React from 'react';
import type { ToolPart } from '@opencode-ai/sdk/v2';

import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { PiExtensionPromptCard } from '@/components/chat/PiExtensionPromptCard';
import { usePiExtensionUiPrompts } from '@/sync/pi-extension-ui-store';
import {
  isActiveQuestionToolStatus,
  matchPendingQuestionPrompt,
  questionItemsFromToolPart,
} from './questionToolItems';

type QuestionToolTurnProps = {
  part: ToolPart;
  sessionID?: string;
};

const QuestionToolPartCard: React.FC<{
  part: ToolPart;
}> = ({ part }) => {
  const { t } = useI18n();
  const state = part.state as {
    status?: string;
    title?: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    output?: string;
    error?: string;
  };
  const items = questionItemsFromToolPart({
    type: part.type,
    tool: part.tool,
    title: typeof state.title === 'string' ? state.title : undefined,
    state,
  });
  const pending = isActiveQuestionToolStatus(state.status);
  const first = items[0];

  return (
    <div className="group w-full pt-0 pb-2">
      <div className="chat-column">
        <div className="-mt-1 border border-border/30 rounded-xl bg-muted/10">
          <div className="px-2 py-1.5 border-b border-border/20">
            <div className="flex items-center gap-2">
              <Icon name="question" className="h-3.5 w-3.5 text-primary" />
              <span className="typography-meta font-medium text-muted-foreground">
                {t('chat.piExtensionUi.inputNeeded')}
              </span>
              {!pending ? (
                <span className="ml-auto typography-micro font-medium text-foreground/70 px-1.5 py-0.5 rounded bg-muted/30 border border-border/20">
                  {first?.cancelled ? t('chat.piExtensionUi.cancelled') : t('chat.piExtensionUi.answered')}
                </span>
              ) : null}
            </div>
          </div>

          <div className="px-2 py-2 space-y-2">
            {items.length === 0 ? (
              <div className="typography-meta text-muted-foreground">{t('chat.toolPart.awaitingResponse')}</div>
            ) : items.map((item, index) => (
              <div key={`${item.question}:${index}`} className="space-y-1.5">
                <div className="typography-meta font-medium text-foreground">
                  {item.question || t('chat.piExtensionUi.questionFallback')}
                </div>
                {item.answer ? (
                  <div className="typography-meta text-foreground whitespace-pre-wrap">{item.answer}</div>
                ) : item.cancelled ? (
                  <div className="typography-meta text-muted-foreground">{t('chat.piExtensionUi.cancelled')}</div>
                ) : (
                  <>
                    {item.options.length > 0 ? (
                      <div className="space-y-0.5">
                        {item.options.map((option) => (
                          <div
                            key={option.label}
                            className="w-full px-1.5 py-1 rounded border border-border/20 bg-muted/20"
                          >
                            <div className="typography-meta text-foreground/80 break-all">{option.label}</div>
                            {option.description ? (
                              <div className="typography-micro text-muted-foreground break-words">{option.description}</div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {pending ? (
                      <div className="typography-meta text-muted-foreground">{t('chat.toolPart.awaitingResponse')}</div>
                    ) : null}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const QuestionToolTurn: React.FC<QuestionToolTurnProps> = ({ part, sessionID }) => {
  const prompts = usePiExtensionUiPrompts(sessionID);
  const state = part.state as { title?: string };
  const pending = matchPendingQuestionPrompt(prompts, {
    type: part.type,
    tool: part.tool,
    title: typeof state.title === 'string' ? state.title : undefined,
    state: part.state as {
      status?: string;
      input?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      output?: string;
      error?: string;
    },
  });

  if (pending) {
    return <PiExtensionPromptCard prompt={pending} />;
  }

  return <QuestionToolPartCard part={part} />;
};
