import express from 'express';

const json = (res, status, body) => {
  res.status(status).json(body);
};

const requestDirectory = (req) => {
  const query = typeof req.query?.directory === 'string' ? req.query.directory.trim() : '';
  if (query) return query;
  const header = req.headers?.['x-opencode-directory'];
  if (typeof header === 'string' && header.trim()) {
    if (req.headers['x-opencode-directory-encoding'] === 'uri') {
      try {
        return decodeURIComponent(header.trim());
      } catch {
        return header.trim();
      }
    }
    return header.trim();
  }
  return '';
};

const unsupported = (name) => ({
  error: 'unsupported',
  message: `${name} is not implemented on the Pi kernel`,
  kernel: 'pi',
});

export const registerPiFacade = (app, { host, bus, defaultDirectory = process.cwd() } = {}) => {
  if (!app || !host) {
    throw new Error('registerPiFacade requires app and host');
  }
  if (app.get('piFacadeConfigured')) {
    return;
  }
  app.set('piFacadeConfigured', true);

  const resolveDirectory = (req) => requestDirectory(req) || defaultDirectory;
  const parseJson = express.json({ limit: '50mb' });

  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (res.headersSent) {
        return next(error);
      }
      const status = Number(error?.status) || 500;
      json(res, status, { error: error?.message || 'Pi facade error' });
    }
  };

  app.get('/api/path', handle(async (req, res) => {
    json(res, 200, host.getPath(resolveDirectory(req)));
  }));

  app.get('/api/global/config', handle(async (_req, res) => {
    json(res, 200, { kernel: 'pi' });
  }));

  app.get('/api/config', handle(async (_req, res) => {
    json(res, 200, { kernel: 'pi' });
  }));

  app.patch('/api/config', parseJson, handle(async (req, res) => {
    json(res, 200, { kernel: 'pi', ...(req.body?.config || req.body || {}) });
  }));

  app.get('/api/config/providers', handle(async (_req, res) => {
    json(res, 200, await host.getProviders());
  }));

  app.get('/api/provider', handle(async (_req, res) => {
    const { providers } = await host.getProviders();
    json(res, 200, providers);
  }));

  app.get('/api/project', handle(async (req, res) => {
    const directory = resolveDirectory(req);
    json(res, 200, [{
      id: directory,
      worktree: directory,
      sandboxes: [],
      time: { created: Date.now(), updated: Date.now() },
    }]);
  }));

  app.get('/api/project/current', handle(async (req, res) => {
    const directory = resolveDirectory(req);
    json(res, 200, {
      id: directory,
      worktree: directory,
      sandboxes: [],
      time: { created: Date.now(), updated: Date.now() },
    });
  }));

  app.get('/api/command', handle(async (_req, res) => {
    json(res, 200, []);
  }));

  app.get('/api/agent', handle(async (_req, res) => {
    json(res, 200, [{
      name: 'pi',
      mode: 'primary',
      native: true,
      hidden: false,
      description: 'Pi coding agent',
    }]);
  }));

  app.get('/api/mcp', handle(async (_req, res) => {
    json(res, 200, {});
  }));

  app.get('/api/lsp', handle(async (_req, res) => {
    json(res, 200, []);
  }));

  app.get('/api/vcs', handle(async (_req, res) => {
    json(res, 200, {});
  }));

  app.get('/api/question', handle(async (_req, res) => {
    json(res, 200, []);
  }));

  app.post('/api/question/:requestID/reply', parseJson, handle(async (_req, res) => {
    json(res, 200, true);
  }));

  app.post('/api/question/:requestID/reject', parseJson, handle(async (_req, res) => {
    json(res, 200, true);
  }));

  app.get('/api/permission', handle(async (_req, res) => {
    json(res, 200, []);
  }));

  app.post('/api/permission/:requestID/reply', parseJson, handle(async (_req, res) => {
    json(res, 200, true);
  }));

  app.get('/api/tool', handle(async (_req, res) => {
    json(res, 200, ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']);
  }));

  app.get('/api/session/status', handle(async (req, res) => {
    json(res, 200, host.getStatus(requestDirectory(req) || undefined));
  }));

  app.get('/api/session', handle(async (req, res) => {
    const directory = requestDirectory(req);
    const records = host.listSessions(directory || undefined);
    json(res, 200, records.map((record) => record.info));
  }));

  app.get('/api/experimental/session', handle(async (req, res) => {
    const directory = requestDirectory(req);
    const records = host.listSessions(directory || undefined);
    json(res, 200, records.map((record) => record.info));
  }));

  app.post('/api/session', parseJson, handle(async (req, res) => {
    const record = await host.createSession({
      directory: resolveDirectory(req),
      title: req.body?.title,
      parentID: req.body?.parentID,
      metadata: req.body?.metadata,
    });
    json(res, 200, record.info);
  }));

  app.get('/api/session/:sessionID', handle(async (req, res) => {
    json(res, 200, host.getSession(req.params.sessionID).info);
  }));

  app.delete('/api/session/:sessionID', parseJson, handle(async (req, res) => {
    json(res, 200, host.deleteSession(req.params.sessionID));
  }));

  app.patch('/api/session/:sessionID', parseJson, handle(async (req, res) => {
    const record = host.updateSession(req.params.sessionID, req.body || {});
    json(res, 200, record.info);
  }));

  app.get('/api/session/:sessionID/message', handle(async (req, res) => {
    json(res, 200, host.getMessages(req.params.sessionID));
  }));

  app.get('/api/session/:sessionID/todo', handle(async (_req, res) => {
    json(res, 200, []);
  }));

  app.post('/api/session/:sessionID/prompt_async', parseJson, handle(async (req, res) => {
    const result = await host.promptAsync(req.params.sessionID, req.body || {});
    json(res, 200, result);
  }));

  app.post('/api/session/:sessionID/prompt', parseJson, handle(async (req, res) => {
    const result = await host.promptAsync(req.params.sessionID, req.body || {});
    json(res, 200, result);
  }));

  app.post('/api/session/:sessionID/abort', parseJson, handle(async (req, res) => {
    json(res, 200, await host.abort(req.params.sessionID));
  }));

  app.post('/api/session/:sessionID/command', parseJson, handle(async (req, res) => {
    const command = typeof req.body?.command === 'string' ? req.body.command : '';
    const args = typeof req.body?.arguments === 'string' ? req.body.arguments : '';
    const text = [command, args].filter(Boolean).join(' ').trim();
    const result = await host.promptAsync(req.params.sessionID, {
      ...req.body,
      parts: text ? [{ type: 'text', text: `/${text}` }] : req.body?.parts,
    });
    json(res, 200, result);
  }));

  app.post('/api/session/:sessionID/revert', parseJson, handle(async (_req, res) => {
    json(res, 200, unsupported('session.revert'));
  }));

  app.post('/api/session/:sessionID/unrevert', parseJson, handle(async (_req, res) => {
    json(res, 200, unsupported('session.unrevert'));
  }));

  app.post('/api/session/:sessionID/fork', parseJson, handle(async (req, res) => {
    const source = host.getSession(req.params.sessionID);
    const record = await host.createSession({
      directory: source.directory,
      title: source.info.title,
      parentID: source.id,
    });
    json(res, 200, record.info);
  }));

  app.post('/api/session/:sessionID/share', parseJson, handle(async (_req, res) => {
    json(res, 200, unsupported('session.share'));
  }));

  app.post('/api/session/:sessionID/summarize', parseJson, handle(async (_req, res) => {
    json(res, 200, true);
  }));

  app.post('/api/session/:sessionID/shell', parseJson, handle(async (_req, res) => {
    json(res, 200, unsupported('session.shell'));
  }));

  if (bus) {
    app.get('/api/global/event', (req, res) => {
      bus.attachSse(req, res);
    });
    app.get('/api/event', (req, res) => {
      bus.attachSse(req, res);
    });
  }
};
