import express from 'express';
import { resolveActiveProjectDirectory, resolvePiDefaultModel } from './pi-resources.js';
import { findProjectFiles } from './find-files.js';
import { handleFetchRemoteProviderModels } from './remote-provider-models.js';

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
    '/log', '/instance', '/formatter', '/tool', '/user', '/auth',
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


  const resolveDirectory = (req) => requestDirectory(req) || resolveActiveProjectDirectory() || defaultDirectory;
  const loadSession = async (req) => {
    const sessionID = req.params.sessionID;
    const directory = resolveDirectory(req);
    if (typeof host.ensureSession === 'function') {
      return host.ensureSession(sessionID, directory);
    }
    return host.getSession(sessionID);
  };
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

  // OpenCode SDK calls GET /user (and /api/user). A missing handler used to
  // fall through to the generic proxy, which self-fetched this same process
  // and 500'd after ~8s.
  const piUser = () => ({
    id: 'usr_pi',
    email: 'pi@localhost',
    name: 'Pichamber',
  });
  app.get('/api/user', handle(async (_req, res) => {
    json(res, 200, piUser());
  }));
  app.get('/user', handle(async (_req, res) => {
    json(res, 200, piUser());
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

  const providerAuth = (_req, res) => {
    try {
      json(res, 200, typeof host.getAuthMethods === 'function' ? host.getAuthMethods() : {});
    } catch {
      json(res, 200, {});
    }
  };
  app.get('/api/provider/auth', handle(async (req, res) => {
    providerAuth(req, res);
  }));
  app.get('/provider/auth', handle(async (req, res) => {
    providerAuth(req, res);
  }));

  const providerSource = (req, res) => {
    const providerId = req.params.providerId;
    const directory = resolveDirectory(req);
    const payload = typeof host.getProviderSources === 'function'
      ? host.getProviderSources(providerId, directory)
      : { sources: { auth: { exists: false }, user: { exists: false }, project: { exists: false }, custom: { exists: false } } };
    json(res, 200, { providerId, sources: payload.sources || payload });
  };
  app.get('/api/provider/:providerId/source', handle(async (req, res) => {
    providerSource(req, res);
  }));

  const authBody = (req) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    return body.auth && typeof body.auth === 'object' && !Array.isArray(body.auth) ? body.auth : body;
  };

  const providerIdFromRequest = (req) => (
    req.params.provider
    || req.params.providerID
    || req.params.providerId
    || (typeof req.body?.providerID === 'string' ? req.body.providerID : '')
    || (typeof req.body?.providerId === 'string' ? req.body.providerId : '')
  );

  const setProviderAuth = (req, res) => {
    const providerId = providerIdFromRequest(req);
    if (typeof host.setProviderAuth !== 'function') {
      json(res, 404, unsupported(`PUT /api/auth/${providerId}`));
      return;
    }
    host.setProviderAuth(providerId, authBody(req));
    json(res, 200, true);
  };
  app.put('/api/auth/:provider', parseJson, handle(async (req, res) => {
    setProviderAuth(req, res);
  }));

  const deleteAuthByProvider = (req, res, { boolean = false } = {}) => {
    const providerId = providerIdFromRequest(req);
    if (typeof host.removeProviderAuth !== 'function') {
      json(res, 404, unsupported(`DELETE /api/auth/${providerId}`));
      return;
    }
    const result = host.removeProviderAuth(providerId);
    if (boolean) {
      json(res, 200, true);
      return;
    }
    json(res, 200, {
      success: true,
      removed: Boolean(result?.removed),
      kernel: 'pi',
      requiresReload: false,
      message: result?.removed ? 'Provider disconnected' : 'Provider was not connected',
    });
  };
  app.delete('/api/auth/:provider', handle(async (req, res) => {
    deleteAuthByProvider(req, res, { boolean: true });
  }));

  app.post('/api/provider/models', parseJson, handle(async (req, res) => {
    await handleFetchRemoteProviderModels(req, res, { home: host.getPath().home });
  }));

  app.put('/api/provider', parseJson, handle(async (req, res) => {
    if (typeof host.upsertProvider !== 'function') {
      json(res, 501, unsupported('provider.upsert'));
      return;
    }
    const providerID = typeof req.body?.providerID === 'string'
      ? req.body.providerID
      : (typeof req.body?.providerId === 'string' ? req.body.providerId : '');
    const result = host.upsertProvider(providerID, req.body?.config, {
      directory: resolveDirectory(req),
      scope: typeof req.body?.scope === 'string' ? req.body.scope : 'user',
    });
    json(res, 200, {
      success: true,
      kernel: 'pi',
      requiresReload: true,
      requiresRestart: false,
      message: 'Provider saved',
      providerId: result.providerId,
      path: result.path,
      config: result.config,
    });
  }));

  app.delete('/api/provider/:providerId/auth', handle(async (req, res) => {
    const providerId = req.params.providerId;
    const scope = typeof req.query?.scope === 'string' ? req.query.scope : 'auth';
    if (scope !== 'auth' && scope !== 'user' && scope !== 'project' && scope !== 'custom' && scope !== 'all') {
      json(res, 400, { error: 'Invalid scope' });
      return;
    }
    const directory = resolveDirectory(req);
    let removed = false;
    if (scope === 'auth' || scope === 'all') {
      if (typeof host.removeProviderAuth === 'function') {
        removed = Boolean(host.removeProviderAuth(providerId).removed) || removed;
      }
    }
    if (scope === 'user' || scope === 'custom' || scope === 'all') {
      if (typeof host.deleteProvider === 'function') {
        removed = Boolean(host.deleteProvider(providerId, { directory, scope: 'user' }).removed) || removed;
      }
    }
    if (scope === 'project' || scope === 'all') {
      if (typeof host.deleteProvider === 'function') {
        removed = Boolean(host.deleteProvider(providerId, { directory, scope: 'project' }).removed) || removed;
      }
    }
    json(res, 200, {
      success: true,
      removed,
      kernel: 'pi',
      requiresReload: false,
      requiresRestart: false,
      message: removed ? 'Provider disconnected' : 'Provider was not connected',
    });
  }));

  const piReload = async (_req, res) => {
    const result = typeof host.reload === 'function'
      ? await host.reload()
      : { reloaded: true, kernel: 'pi' };
    json(res, 200, {
      success: true,
      kernel: 'pi',
      requiresReload: false,
      reloaded: true,
      message: 'Pi kernel reloaded',
      ...result,
    });
  };
  app.post('/api/config/reload', handle(piReload));
  app.post('/config/reload', handle(piReload));

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
    const sessionID = typeof req.query?.session === 'string' ? req.query.session.trim() : '';
    json(res, 200, host.listCommands(resolveDirectory(req), sessionID ? { sessionID } : {}));
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
    const defaults = host.getDefaults();
    let resolvedModel = typeof defaults.model === 'string' ? defaults.model.trim() : '';
    try {
      const catalog = await host.getProviders();
      resolvedModel = resolvePiDefaultModel(defaults.model, catalog?.providers || []);
    } catch {
      // Keep the stored model when the catalog is unavailable.
    }
    json(res, 200, { ...defaults, resolvedModel });
  }));

  app.patch('/api/pi/defaults', parseJson, handle(async (req, res) => {
    json(res, 200, host.setDefaults(req.body || {}));
  }));

  app.get('/api/pi/trust', handle(async (req, res) => {
    json(res, 200, host.getProjectTrust(resolveDirectory(req)));
  }));

  app.put('/api/pi/trust', parseJson, handle(async (req, res) => {
    json(res, 200, host.setProjectTrust(req.body || {}, resolveDirectory(req)));
  }));

  app.post('/api/pi/trust', parseJson, handle(async (req, res) => {
    const directory = (typeof req.body?.directory === 'string' && req.body.directory.trim())
      ? req.body.directory.trim()
      : resolveDirectory(req);
    const trusted = req.body?.trusted !== false && req.body?.trusted !== 'false';
    json(res, 200, host.trustProject(directory, trusted));
  }));

  app.get('/api/pi/extensions', handle(async (req, res) => {
    const directory = resolveDirectory(req);
    json(res, 200, {
      extensions: typeof host.listExtensions === 'function' ? host.listExtensions(directory) : [],
      packages: typeof host.listPackages === 'function' ? host.listPackages(directory) : [],
    });
  }));

  app.get('/api/pi/feature-plugins', handle(async (_req, res) => {
    json(res, 200, host.getFeaturePlugins());
  }));

  app.patch('/api/pi/feature-plugins', parseJson, handle(async (req, res) => {
    json(res, 200, host.setFeaturePlugins(req.body || {}));
  }));

  app.post('/api/pi/feature-plugins/:slot/install', parseJson, handle(async (req, res) => {
    json(res, 200, await host.installFeaturePlugin(req.params.slot, req.body || {}));
  }));

  app.post('/api/pi/feature-plugins/:slot/uninstall', parseJson, handle(async (req, res) => {
    json(res, 200, await host.uninstallFeaturePlugin(req.params.slot, req.body || {}));
  }));

  app.get('/api/config/agents', handle(async (_req, res) => {
    json(res, 200, [{
      name: 'pi',
      mode: 'primary',
      native: true,
      hidden: false,
      description: 'Pi coding agent',
    }]);
  }));

  app.get('/api/plugin', handle(async (_req, res) => {
    json(res, 200, []);
  }));

  app.get('/api/prompts', handle(async (_req, res) => {
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

  const handleFindFiles = handle(async (req, res) => {
    const directory = resolveDirectory(req);
    const query = typeof req.query?.query === 'string' ? req.query.query : '';
    const limit = Number(req.query?.limit);
    const includeDirs = req.query?.dirs !== 'false';
    const type = req.query?.type === 'directory' || req.query?.type === 'file' ? req.query.type : null;
    json(res, 200, findProjectFiles(directory, { query, limit, includeDirs, type }));
  });
  // OpenCode SDK v2 find.files hits /find/file (rewritten to /api/find/file).
  app.get('/api/find/files', handleFindFiles);
  app.get('/api/find/file', handleFindFiles);


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
    json(res, 200, (await loadSession(req)).info);
  }));

  app.delete('/api/session/:sessionID', parseJson, handle(async (req, res) => {
    json(res, 200, await host.deleteSession(req.params.sessionID, resolveDirectory(req)));
  }));

  app.patch('/api/session/:sessionID', parseJson, handle(async (req, res) => {
    const record = await host.updateSession(req.params.sessionID, req.body || {}, resolveDirectory(req));
    json(res, 200, record.info);
  }));

  app.get('/api/session/:sessionID/message', handle(async (req, res) => {
    await loadSession(req);
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

  app.post('/api/session/:sessionID/reload', parseJson, handle(async (req, res) => {
    const result = await host.reload({ sessionID: req.params.sessionID });
    json(res, 200, {
      success: true,
      kernel: 'pi',
      reloaded: true,
      ...result,
    });
  }));

  app.post('/api/session/:sessionID/command', parseJson, handle(async (req, res) => {
    if (typeof host.runCommand === 'function') {
      json(res, 200, await host.runCommand(req.params.sessionID, req.body || {}));
      return;
    }
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
    json(res, 501, unsupported('session.revert'));
  }));

  app.post('/api/session/:sessionID/unrevert', parseJson, handle(async (_req, res) => {
    json(res, 501, unsupported('session.unrevert'));
  }));

  app.get('/api/session/:sessionID/tree', handle(async (req, res) => {
    await loadSession(req);
    json(res, 200, host.getSessionTree(req.params.sessionID));
  }));

  app.get('/api/session/:sessionID/usage', handle(async (req, res) => {
    await loadSession(req);
    json(res, 200, host.getSessionUsage(req.params.sessionID));
  }));

  app.patch('/api/session/:sessionID/thinking', parseJson, handle(async (req, res) => {
    const level = req.body?.thinking ?? req.body?.level ?? req.body?.variant;
    json(res, 200, await host.setSessionThinking(req.params.sessionID, level));
  }));

  app.patch('/api/session/:sessionID/model', parseJson, handle(async (req, res) => {
    const model = req.body?.model ?? req.body?.modelID ?? req.body?.id;
    json(res, 200, await host.setSessionModel(req.params.sessionID, model));
  }));

  app.post('/api/session/:sessionID/fork', parseJson, handle(async (req, res) => {
    const messageID = req.body?.messageID ?? req.body?.messageId;
    const record = typeof host.forkSession === 'function'
      ? await host.forkSession(req.params.sessionID, messageID)
      : await host.createSession({
        directory: (await loadSession(req)).directory,
        title: (await loadSession(req)).info.title,
        parentID: req.params.sessionID,
      });
    json(res, 200, record.info);
  }));

  app.post('/api/session/:sessionID/clone', parseJson, handle(async (req, res) => {
    const record = await host.cloneSession(req.params.sessionID);
    json(res, 200, record.info);
  }));

  const sendSessionExport = async (req, res) => {
    await loadSession(req);
    const format = typeof req.query?.format === 'string' ? req.query.format.toLowerCase() : (req.body?.format || 'jsonl');
    const exported = host.exportSession(req.params.sessionID, format);
    res.setHeader('Content-Type', exported.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.status(200).send(exported.content);
  };
  app.get('/api/session/:sessionID/export', handle(async (req, res) => {
    await sendSessionExport(req, res);
  }));
  app.post('/api/session/:sessionID/export', parseJson, handle(async (req, res) => {
    await sendSessionExport(req, res);
  }));

  app.post('/api/session/import', parseJson, handle(async (req, res) => {
    const jsonl = typeof req.body?.jsonl === 'string'
      ? req.body.jsonl
      : (typeof req.body?.content === 'string' ? req.body.content : '');
    if (!jsonl.trim()) {
      json(res, 400, { error: 'Import body is empty' });
      return;
    }
    const record = await host.importSession({
      jsonl,
      directory: resolveDirectory(req),
      title: req.body?.title,
    });
    json(res, 200, record.info);
  }));

  app.post('/api/session/:sessionID/share', parseJson, handle(async (_req, res) => {
    json(res, 200, unsupported('session.share'));
  }));

  app.post('/api/session/:sessionID/summarize', parseJson, handle(async (req, res) => {
    const instructions = typeof req.body?.arguments === 'string'
      ? req.body.arguments
      : (typeof req.body?.instructions === 'string' ? req.body.instructions : '');
    if (typeof host.compactSession === 'function') {
      await host.compactSession(req.params.sessionID, instructions);
    } else if (typeof host.runCommand === 'function') {
      await host.runCommand(req.params.sessionID, {
        ...(req.body || {}),
        command: 'compact',
        arguments: instructions,
      });
    }
    json(res, 200, true);
  }));

  app.post('/api/session/:sessionID/shell', parseJson, handle(async (_req, res) => {
    json(res, 501, unsupported('session.shell'));
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
