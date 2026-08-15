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

  // OpenCode SDK v2 calls unprefixed paths (/command, /session, ...) when
  // baseUrl is the host origin (desktop injects http://127.0.0.1:3901).
  // Chat uses /api/* via runtimeFetch; settings/SDK use the bare paths.
  const sdkRoots = [
    '/command', '/session', '/provider', '/config', '/path', '/event',
    '/global', '/project', '/agent', '/skill', '/mcp', '/lsp', '/vcs',
    '/file', '/find', '/pty', '/permission', '/question', '/experimental',
    '/log', '/instance', '/formatter', '/tool',
  ];
  const uiAuthPaths = ['/auth/session', '/auth/passkey', '/auth/url-token'];
  app.use((req, _res, next) => {
    const pathname = (req.path || '').split('?')[0];
    if (uiAuthPaths.some((root) => pathname === root || pathname.startsWith(`${root}/`))) {
      next();
      return;
    }
    if (sdkRoots.some((root) => pathname === root || pathname.startsWith(`${root}/`))) {
      req.url = `/api${req.url}`;
    }
    next();
  });


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

  app.get('/api/kernel', handle(async (_req, res) => {
    json(res, 200, host.getKernelInfo());
  }));

  app.get('/api/health', handle(async (_req, res) => {
    json(res, 200, { healthy: true, kernel: 'pi' });
  }));

  app.get('/api/auth/session', handle(async (_req, res) => {
    json(res, 200, { authenticated: true, disabled: true, kernel: 'pi' });
  }));
  app.post('/api/auth/session', parseJson, handle(async (_req, res) => {
    json(res, 200, { authenticated: true, disabled: true, kernel: 'pi' });
  }));

  app.get('/api/global/config', handle(async (_req, res) => {
    json(res, 200, { kernel: 'pi', ...host.getDefaults() });
  }));

  app.get('/api/config', handle(async (_req, res) => {
    json(res, 200, { kernel: 'pi', ...host.getDefaults() });
  }));

  app.patch('/api/config', parseJson, handle(async (req, res) => {
    const patch = req.body?.config || req.body || {};
    json(res, 200, { kernel: 'pi', ...host.setDefaults(patch) });
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

  app.get('/api/command', handle(async (req, res) => {
    json(res, 200, host.listCommands(resolveDirectory(req)));
  }));

  app.get('/api/config/commands/:name', handle(async (req, res) => {
    const command = host.listCommands(resolveDirectory(req)).find((item) => item.name === req.params.name);
    if (!command) {
      json(res, 404, { error: 'Command not found' });
      return;
    }
    json(res, 200, {
      ...command,
      scope: command.source === 'builtin' ? undefined : 'user',
      sources: command.path ? { md: { exists: true, path: command.path, scope: 'user' } } : {},
    });
  }));

  const writeCommand = (req, res) => {
    const created = host.writeCommand(resolveDirectory(req), req.params.name, req.body || {});
    json(res, 200, {
      ...created,
      sources: created.path ? { md: { exists: true, path: created.path, scope: created.scope } } : {},
    });
  };
  app.post('/api/config/commands/:name', parseJson, handle(async (req, res) => {
    writeCommand(req, res);
  }));
  app.patch('/api/config/commands/:name', parseJson, handle(async (req, res) => {
    writeCommand(req, res);
  }));
  app.delete('/api/config/commands/:name', handle(async (req, res) => {
    json(res, 200, host.deleteCommand(resolveDirectory(req), req.params.name));
  }));

  app.get('/api/config/skills', handle(async (req, res) => {
    json(res, 200, host.getConfigSkills(resolveDirectory(req)));
  }));

  app.get('/api/skill', handle(async (req, res) => {
    const skills = host.listSkills(resolveDirectory(req)).map((skill) => ({
      name: skill.name,
      description: skill.description,
      location: skill.path,
      content: skill.content,
    }));
    json(res, 200, skills);
  }));


  app.get('/api/pi/skills', handle(async (req, res) => {
    json(res, 200, { skills: host.listSkills(resolveDirectory(req)) });
  }));

  app.get('/api/pi/prompts', handle(async (req, res) => {
    json(res, 200, { prompts: host.listPrompts(resolveDirectory(req)) });
  }));

  app.get('/api/pi/models', handle(async (_req, res) => {
    json(res, 200, await host.getProviders());
  }));

  app.get('/api/pi/defaults', handle(async (_req, res) => {
    json(res, 200, host.getDefaults());
  }));

  app.patch('/api/pi/defaults', parseJson, handle(async (req, res) => {
    json(res, 200, host.setDefaults(req.body || {}));
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

  const listSessionInfos = async (directory) => {
    const live = host.listSessions(directory || undefined).map((record) => record.info);
    const seen = new Set(live.map((info) => info.id));
    if (typeof host.listPersistedSessions === 'function') {
      const persisted = await host.listPersistedSessions(directory || undefined);
      for (const item of persisted || []) {
        const id = item.id || item.path;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        live.push({
          id,
          projectID: item.cwd || directory || 'pi',
          directory: item.cwd || directory,
          title: item.name || item.firstMessage || 'Pi session',
          version: 'pi',
          time: {
            created: item.created ? new Date(item.created).getTime() : Date.now(),
            updated: item.modified ? new Date(item.modified).getTime() : Date.now(),
          },
        });
      }
    }
    return live;
  };

  app.get('/api/session', handle(async (req, res) => {
    json(res, 200, await listSessionInfos(requestDirectory(req)));
  }));

  app.get('/api/experimental/session', handle(async (req, res) => {
    json(res, 200, await listSessionInfos(requestDirectory(req)));
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

  app.post('/api/session/:sessionID/clone', parseJson, handle(async (req, res) => {
    const record = await host.cloneSession(req.params.sessionID);
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
