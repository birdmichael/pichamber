/**
 * Desktop mapping for the installed Pi `question` tool.
 *
 * The official extension (`examples/extensions/question.ts`) guards on
 * `ctx.mode === "tui"` and then calls `ctx.ui.custom` with a TUI Editor.
 * Desktop binds `mode: "rpc"` and cannot run that factory. Mutating the live
 * tool definition's `execute` (the wrapper reads it at call time) maps the
 * same params onto `ctx.ui.select` + `editor` — the existing in-chat card.
 * `GET /api/question` stays a stub.
 */

export const QUESTION_TYPE_SOMETHING_LABEL = 'Type something.';

const DESKTOP_ADAPTED = Symbol('pichamberQuestionDesktopAdapted');

export const isFreeformOtherOption = (option) => {
  const trimmed = String(option ?? '').trim();
  return /^(?:\d+\.\s*)?other\b/i.test(trimmed)
    || /^(?:\d+\.\s*)?type something\.?\s*$/i.test(trimmed);
};

const optionLabel = (option) => {
  if (typeof option === 'string') return option;
  if (option && typeof option === 'object' && typeof option.label === 'string') {
    return option.label;
  }
  return String(option ?? '');
};

const optionDescription = (option) => (
  option && typeof option === 'object' && typeof option.description === 'string'
    ? option.description.trim()
    : ''
);

export const formatQuestionSelectOptions = (options) => {
  const list = Array.isArray(options) ? options : [];
  const formatted = list.map((option, index) => {
    const label = optionLabel(option);
    const description = optionDescription(option);
    const numbered = `${index + 1}. ${label}`;
    return description ? `${numbered} — ${description}` : numbered;
  });
  formatted.push(`${list.length + 1}. ${QUESTION_TYPE_SOMETHING_LABEL}`);
  return formatted;
};

const simpleOptionLabels = (options) => (
  (Array.isArray(options) ? options : []).map((option) => optionLabel(option))
);

const questionToolResultFromPrompt = (params, result) => {
  const question = typeof params?.question === 'string' ? params.question : '';
  const options = simpleOptionLabels(params?.options);

  if (!result) {
    return {
      content: [{ type: 'text', text: 'User cancelled the selection' }],
      details: { question, options, answer: null },
    };
  }

  if (result.wasCustom) {
    return {
      content: [{ type: 'text', text: `User wrote: ${result.answer}` }],
      details: {
        question,
        options,
        answer: result.answer,
        wasCustom: true,
      },
    };
  }

  return {
    content: [{ type: 'text', text: `User selected: ${result.index}. ${result.answer}` }],
    details: {
      question,
      options,
      answer: result.answer,
      wasCustom: false,
    },
  };
};

export const runQuestionDesktopPrompt = async (params, ui) => {
  const options = Array.isArray(params?.options) ? params.options : [];
  if (options.length === 0) {
    return { error: 'empty-options' };
  }
  if (!ui || typeof ui.select !== 'function' || typeof ui.editor !== 'function') {
    return null;
  }

  const labels = simpleOptionLabels(options);
  const selectOptions = formatQuestionSelectOptions(options);
  const title = typeof params?.question === 'string' ? params.question : '';
  const selected = await ui.select(title, selectOptions);
  if (selected === undefined) return null;

  const selectedIndex = selectOptions.indexOf(selected);
  const pickedOther = selectedIndex === selectOptions.length - 1
    || isFreeformOtherOption(selected);

  if (pickedOther) {
    const text = await ui.editor(title, '');
    if (text === undefined) return null;
    const trimmed = String(text).trim();
    if (!trimmed) return null;
    return { answer: trimmed, wasCustom: true };
  }

  if (selectedIndex >= 0 && selectedIndex < labels.length) {
    return {
      answer: labels[selectedIndex],
      wasCustom: false,
      index: selectedIndex + 1,
    };
  }

  const fallback = String(selected).replace(/^\d+\.\s*/, '').split(/\s+[—–]\s+/)[0]?.trim();
  if (!fallback) return null;
  const labelIndex = labels.indexOf(fallback);
  return {
    answer: fallback,
    wasCustom: false,
    index: labelIndex >= 0 ? labelIndex + 1 : 0,
  };
};

export const executeQuestionViaDesktopUi = async (params, ui) => {
  const options = Array.isArray(params?.options) ? params.options : [];
  const question = typeof params?.question === 'string' ? params.question : '';
  if (options.length === 0) {
    return {
      content: [{ type: 'text', text: 'Error: No options provided' }],
      details: { question, options: [], answer: null },
    };
  }

  const result = await runQuestionDesktopPrompt(params, ui);
  if (result?.error === 'empty-options') {
    return {
      content: [{ type: 'text', text: 'Error: No options provided' }],
      details: { question, options: [], answer: null },
    };
  }
  return questionToolResultFromPrompt(params, result);
};

export const adaptQuestionToolForDesktop = (piSession, ui) => {
  if (!piSession || typeof piSession.getToolDefinition !== 'function') return false;
  const definition = piSession.getToolDefinition('question');
  if (!definition || typeof definition.execute !== 'function') return false;
  if (definition.execute[DESKTOP_ADAPTED]) return true;

  const execute = async (_toolCallId, params, _signal, _onUpdate, ctx) => (
    executeQuestionViaDesktopUi(params, ctx?.ui ?? ui)
  );
  execute[DESKTOP_ADAPTED] = true;
  definition.execute = execute;
  return true;
};
