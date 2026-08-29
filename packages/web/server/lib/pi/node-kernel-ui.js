import { createNoopUiExtras } from './extension-ui.js';

/** AbortSignal cannot cross the Node-child IPC boundary as an EventTarget. */
export const serializeUiOpts = (opts) => {
  if (!opts || typeof opts !== 'object') return undefined;
  const next = {};
  if (opts.multiple === true) next.multiple = true;
  if (Number.isFinite(opts.timeout) && opts.timeout > 0) next.timeout = opts.timeout;
  if (opts.signal && typeof opts.signal === 'object') {
    next.signal = { aborted: opts.signal.aborted === true };
  }
  return Object.keys(next).length > 0 ? next : undefined;
};

const createNodeKernelChildUi = ({ parentRequest, sessionId } = {}) => {
  const request = typeof parentRequest === 'function'
    ? parentRequest
    : async () => undefined;
  return {
    ...createNoopUiExtras(),
    async select(title, options, opts) {
      return request('ui.select', {
        sessionId,
        title,
        options,
        opts: serializeUiOpts(opts),
      });
    },
    async confirm(title, message) {
      return request('ui.confirm', {
        sessionId,
        title,
        message,
      });
    },
    async input(title, placeholder, opts) {
      const hasPlaceholder = typeof placeholder === 'string';
      return request('ui.input', {
        sessionId,
        title,
        placeholder: hasPlaceholder ? placeholder : undefined,
        opts: serializeUiOpts(hasPlaceholder ? opts : placeholder),
      });
    },
    async editor(title, prefill, opts) {
      const hasPrefill = typeof prefill === 'string';
      return request('ui.editor', {
        sessionId,
        title,
        prefill: hasPrefill ? prefill : undefined,
        opts: serializeUiOpts(hasPrefill ? opts : prefill),
      });
    },
    notify(message, level) {
      return request('ui.notify', {
        sessionId,
        message,
        level,
      });
    },
  };
};

export const bindNodeKernelChildUiContext = (session, bindings = {}, parentRequest) => ({
  ...bindings,
  uiContext: createNodeKernelChildUi({
    parentRequest,
    sessionId: session?.sessionId,
  }),
  mode: bindings.mode || 'rpc',
});
