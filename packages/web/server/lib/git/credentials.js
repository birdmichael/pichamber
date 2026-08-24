import fs from 'fs';
import path from 'path';
import os from 'os';

const GIT_CREDENTIALS_PATH = path.join(os.homedir(), '.git-credentials');

export function discoverGitCredentials() {
  const credentials = [];

  if (!fs.existsSync(GIT_CREDENTIALS_PATH)) {
    return credentials;
  }

  try {
    const content = fs.readFileSync(GIT_CREDENTIALS_PATH, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const url = new URL(line.trim());
        const hostname = url.hostname;
        const pathname = url.pathname && url.pathname !== '/' ? url.pathname : '';
        const host = hostname + pathname;
        const username = url.username || '';

        if (host && username) {
          const exists = credentials.some(c => c.host === host && c.username === username);
          if (!exists) {
            credentials.push({ host, username });
          }
        }
      } catch {
        continue;
      }
    }
  } catch (error) {
    console.error('Failed to read .git-credentials:', error);
  }

  return credentials;
}

export function upsertGitCredential({ host, username, token }) {
  const safeHost = typeof host === 'string' ? host.trim().replace(/^https?:\/\//, '').split('/')[0] : '';
  const password = typeof token === 'string' ? token.trim() : '';
  if (!safeHost || !password) {
    return false;
  }

  const user = typeof username === 'string' && username.trim() ? username.trim() : 'x-access-token';
  const nextLine = `https://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${safeHost}`;

  let existing = [];
  try {
    if (fs.existsSync(GIT_CREDENTIALS_PATH)) {
      existing = fs.readFileSync(GIT_CREDENTIALS_PATH, 'utf8').split('\n');
    }
  } catch {
    existing = [];
  }

  const kept = existing.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return false;
    }
    try {
      return new URL(trimmed).hostname !== safeHost;
    } catch {
      return true;
    }
  });
  kept.push(nextLine);

  fs.writeFileSync(GIT_CREDENTIALS_PATH, `${kept.join('\n')}\n`, { mode: 0o600 });
  return true;
}
