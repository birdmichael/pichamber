type QuestionToolOption = {
  label: string;
  description?: string;
};

type QuestionToolItem = {
  question: string;
  answer: string;
  cancelled: boolean;
  options: QuestionToolOption[];
};

type QuestionToolPartLike = {
  type?: string;
  tool?: string;
  title?: string;
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    output?: string;
    error?: string;
  };
};

const asTrimmedString = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

export const isQuestionToolName = (name: unknown): boolean => {
  const tool = asTrimmedString(name).toLowerCase();
  return tool === 'question' || tool === 'plan_mode_question';
};

const optionFromUnknown = (value: unknown): QuestionToolOption | null => {
  if (typeof value === 'string') {
    const label = value.trim();
    return label ? { label } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const label = asTrimmedString(record.label || record.title || record.question);
  if (!label) return null;
  const description = asTrimmedString(record.description);
  return description ? { label, description } : { label };
};

const optionsFromUnknown = (value: unknown): QuestionToolOption[] => {
  if (!Array.isArray(value)) return [];
  const options: QuestionToolOption[] = [];
  for (const item of value) {
    const option = optionFromUnknown(item);
    if (option) options.push(option);
  }
  return options;
};

const answersFromUnknown = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (Array.isArray(item)) return item.map((part) => String(part)).filter(Boolean).join(', ');
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && typeof (item as { answer?: unknown }).answer === 'string') {
        return (item as { answer: string }).answer;
      }
      return '';
    });
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (value === true) return ['true'];
  if (value === false) return ['false'];
  return [];
};

export const parseQuestionToolOutput = (output: unknown): Array<{ question: string; answer: string }> => {
  const text = String(output ?? '');
  const opencode = text.match(/User has answered your questions:\s*(.+?)(?:\.\s*You can now|$)/s);
  if (opencode) {
    const pairs: Array<{ question: string; answer: string }> = [];
    const pairRegex = /"([^"]+)"="([^"]*)"/g;
    let pairMatch = pairRegex.exec(opencode[1] ?? '');
    while (pairMatch) {
      pairs.push({ question: pairMatch[1] ?? '', answer: pairMatch[2] ?? '' });
      pairMatch = pairRegex.exec(opencode[1] ?? '');
    }
    return pairs;
  }

  const trimmed = text.trim();
  if (/^User cancelled the selection/i.test(trimmed)) return [];

  const selected = trimmed.match(/^User selected:\s*(?:\d+\.\s*)?([\s\S]+)$/i);
  if (selected?.[1]?.trim()) return [{ question: '', answer: selected[1].trim() }];

  const wrote = trimmed.match(/^User wrote:\s*([\s\S]+)$/i);
  if (wrote?.[1]?.trim()) return [{ question: '', answer: wrote[1].trim() }];

  return [];
};

const isCancelledQuestionState = (status: string, error: string, output: string): boolean => (
  status === 'error'
  || status === 'cancelled'
  || /dismissed|cancelled|canceled|ignored/i.test(error)
  || /^User cancelled the selection/i.test(output.trim())
);

const questionsFromInput = (
  input: Record<string, unknown>,
): Array<{ question: string; options: QuestionToolOption[] }> => {
  if (Array.isArray(input.questions)) {
    return input.questions.flatMap((item) => {
      if (typeof item === 'string') {
        const question = item.trim();
        return question ? [{ question, options: [] }] : [];
      }
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const question = asTrimmedString(record.question || record.title || record.header);
      return question ? [{ question, options: optionsFromUnknown(record.options) }] : [];
    });
  }
  const question = asTrimmedString(input.question || input.title);
  return question ? [{ question, options: optionsFromUnknown(input.options) }] : [];
};

export const questionItemsFromToolPart = (part: QuestionToolPartLike): QuestionToolItem[] => {
  const input = part.state?.input && typeof part.state.input === 'object' && !Array.isArray(part.state.input)
    ? part.state.input
    : {};
  const metadata = part.state?.metadata && typeof part.state.metadata === 'object' && !Array.isArray(part.state.metadata)
    ? part.state.metadata
    : {};
  const output = typeof part.state?.output === 'string' ? part.state.output : '';
  const error = typeof part.state?.error === 'string' ? part.state.error : '';
  const status = asTrimmedString(part.state?.status);
  const cancelled = isCancelledQuestionState(status, error, output);
  const parsed = parseQuestionToolOutput(output);
  const questions = questionsFromInput(input);
  const metaQuestion = asTrimmedString(metadata.question);
  const metaAnswer = answersFromUnknown(metadata.answers ?? metadata.answer ?? metadata.value)
    .filter(Boolean)
    .join(', ');
  const answers = Array.isArray(metadata.answers) ? metadata.answers : [];
  const sharedOptions = optionsFromUnknown(metadata.options ?? input.options);

  if (questions.length > 0) {
    return questions.map((item, index) => {
      const fromIndexedMeta = answersFromUnknown(answers[index]).filter(Boolean).join(', ');
      const fromParsed = parsed[index]?.answer || '';
      const fromSingleMeta = questions.length === 1 ? metaAnswer : '';
      const answer = fromIndexedMeta || fromParsed || fromSingleMeta;
      return {
        question: item.question,
        answer,
        cancelled: cancelled && !answer,
        options: item.options.length > 0 ? item.options : sharedOptions,
      };
    });
  }

  if (parsed.length > 0) {
    return parsed.map((item) => ({
      question: item.question || metaQuestion || asTrimmedString(part.title),
      answer: item.answer,
      cancelled: false,
      options: sharedOptions,
    }));
  }

  const title = metaQuestion || asTrimmedString(input.title || part.title);
  if (title) {
    return [{
      question: title,
      answer: metaAnswer,
      cancelled: cancelled && !metaAnswer,
      options: sharedOptions,
    }];
  }

  return [];
};

export const isActiveQuestionToolStatus = (status: unknown): boolean => {
  const value = asTrimmedString(status).toLowerCase();
  return value === 'pending' || value === 'running';
};

type PendingQuestionPromptLike = {
  id: string;
  title?: string;
  status?: string;
  kind?: string;
};

export const matchPendingQuestionPrompt = <T extends PendingQuestionPromptLike>(
  prompts: readonly T[],
  part: QuestionToolPartLike,
): T | null => {
  if (!isQuestionToolName(part.tool)) return null;
  const pending = prompts.filter((prompt) => (
    prompt.status === 'pending'
    && (prompt.kind === 'select' || prompt.kind === 'input' || prompt.kind === 'editor')
  ));
  if (pending.length === 0) return null;
  const items = questionItemsFromToolPart(part);
  const question = items[0]?.question || asTrimmedString(part.title);
  if (question) {
    const titled = pending.find((prompt) => asTrimmedString(prompt.title) === question);
    if (titled) return titled;
  }
  return pending.length === 1 ? pending[0] ?? null : null;
};

export const messagesWithLiveQuestionParts = <T extends {
  info?: { id?: string };
  parts?: readonly QuestionToolPartLike[];
}>(
  messages: readonly T[],
  livePartsByMessageId?: Record<string, readonly QuestionToolPartLike[] | undefined>,
): Array<{ parts?: readonly QuestionToolPartLike[] }> => {
  if (!livePartsByMessageId) return [...messages];
  return messages.map((message) => {
    const liveParts = message.info?.id ? livePartsByMessageId[message.info.id] : undefined;
    return { parts: liveParts ?? message.parts };
  });
};

export const boundQuestionPromptIds = (
  prompts: readonly PendingQuestionPromptLike[],
  messages: readonly { parts?: readonly QuestionToolPartLike[] }[],
): Set<string> => {
  const ids = new Set<string>();
  let activeQuestionTools = 0;
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== 'tool' || !isQuestionToolName(part.tool)) continue;
      if (isActiveQuestionToolStatus(part.state?.status)) activeQuestionTools += 1;
      const match = matchPendingQuestionPrompt(prompts, part);
      if (match) ids.add(match.id);
    }
  }
  const pending = prompts.filter((prompt) => (
    prompt.status === 'pending'
    && (prompt.kind === 'select' || prompt.kind === 'input' || prompt.kind === 'editor')
  ));
  if (ids.size === 0 && pending.length === 1 && activeQuestionTools >= 1) {
    const only = pending[0];
    if (only) ids.add(only.id);
  }
  return ids;
};

export const questionToolDescription = (items: QuestionToolItem[]): string => {
  if (items.length === 0) return '';
  const first = items[0];
  if (items.length === 1) {
    if (first?.answer) return first.answer;
    if (first?.question) return first.question;
    return '';
  }
  return `Asked ${items.length} questions`;
};
