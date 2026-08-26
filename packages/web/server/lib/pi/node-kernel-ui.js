import { createNoopUiExtras } from './extension-ui.js';

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
        opts,
      });
    },
    async confirm(title, message) {
      return request('ui.confirm', {
        sessionId,
        title,
        message,
      });
    },
    async input(title, opts) {
      return request('ui.input', {
        sessionId,
        title,
        opts,
      });
    },
    async editor(title, opts) {
      return request('ui.editor', {
        sessionId,
        title,
        opts,
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
