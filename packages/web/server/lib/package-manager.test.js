import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock child_process to prevent real spawnSync calls that would hang in tests
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0, stdout: '/usr/local/bin', stderr: '' })),
}));

const {
  checkForUpdates,
  detectPackageManager,
  executeUpdate,
  getCurrentVersion,
  getUpdateCommand,
} = await import('./package-manager.js');

/** Helper: create a fetch mock that routes by URL pattern */
function createFetchMock() {
  const handlers = new Map();

  const mock = vi.fn((url) => {
    const urlStr = typeof url === 'string' ? url : url.toString();

    for (const [pattern, response] of handlers) {
      if (urlStr.includes(pattern)) {
        return Promise.resolve(response);
      }
    }

    return Promise.reject(new Error(`Unexpected fetch call: ${urlStr}`));
  });

  mock.when = (pattern, response) => {
    handlers.set(pattern, response);
    return mock;
  };

  return mock;
}

function jsonOk(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  };
}

function httpStatus(status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
  };
}

function fetchedUrls(fetchMock) {
  return fetchMock.mock.calls.map(([url]) => (typeof url === 'string' ? url : url.toString()));
}

function expectPichamberSourcesOnly(fetchMock) {
  for (const url of fetchedUrls(fetchMock)) {
    expect(url).not.toContain('api.openchamber.dev');
    expect(url).not.toContain('openchamber/openchamber');
    expect(url).not.toContain('registry.npmjs.org/@openchamber/web');
  }
}

describe('checkForUpdates', () => {
  let fetchMock;
  let originalFetch;
  let previousPichamberUpdateApiUrl;
  let previousOpenchamberUpdateApiUrl;

  beforeEach(() => {
    fetchMock = createFetchMock();
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    previousPichamberUpdateApiUrl = process.env.PICHAMBER_UPDATE_API_URL;
    previousOpenchamberUpdateApiUrl = process.env.OPENCHAMBER_UPDATE_API_URL;
    delete process.env.PICHAMBER_UPDATE_API_URL;
    delete process.env.OPENCHAMBER_UPDATE_API_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (typeof previousPichamberUpdateApiUrl === 'string') {
      process.env.PICHAMBER_UPDATE_API_URL = previousPichamberUpdateApiUrl;
    } else {
      delete process.env.PICHAMBER_UPDATE_API_URL;
    }
    if (typeof previousOpenchamberUpdateApiUrl === 'string') {
      process.env.OPENCHAMBER_UPDATE_API_URL = previousOpenchamberUpdateApiUrl;
    } else {
      delete process.env.OPENCHAMBER_UPDATE_API_URL;
    }
  });

  it('reports no update when Pichamber has no GitHub release and no npm package', async () => {
    fetchMock
      .when('api.github.com/repos/birdmichael/pichamber/releases/latest', httpStatus(404))
      .when('registry.npmjs.org/@pichamber/web', httpStatus(404));

    const result = await checkForUpdates({ currentVersion: '1.0.0' });

    expect(result.available).toBe(false);
    expect(result.version).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.updateCommand).toBe('pichamber update');
    expectPichamberSourcesOnly(fetchMock);
  });

  it('reports a newer Pichamber GitHub release with a birdmichael/pichamber URL', async () => {
    fetchMock
      .when('api.github.com/repos/birdmichael/pichamber/releases/latest', jsonOk({
        tag_name: 'v1.2.0',
        html_url: 'https://github.com/birdmichael/pichamber/releases/tag/v1.2.0',
        body: '## [1.2.0]\n\n- Pichamber release',
      }))
      .when('registry.npmjs.org/@pichamber/web', httpStatus(404));

    const result = await checkForUpdates({ currentVersion: '1.0.0' });

    expect(result.available).toBe(true);
    expect(result.version).toBe('1.2.0');
    expect(result.currentVersion).toBe('1.0.0');
    expect(result.releaseUrl).toBe('https://github.com/birdmichael/pichamber/releases/tag/v1.2.0');
    expect(result.updateCommand).toBe('pichamber update');
    expectPichamberSourcesOnly(fetchMock);
  });

  it('treats a GitHub failure plus empty npm as an error, not latest via OpenChamber', async () => {
    fetchMock
      .when('api.github.com/repos/birdmichael/pichamber/releases/latest', Promise.reject(new Error('GitHub unreachable')))
      .when('registry.npmjs.org/@pichamber/web', httpStatus(404));

    const result = await checkForUpdates({ currentVersion: '1.0.0' });

    expect(result.available).toBe(false);
    expect(result.version).toBeUndefined();
    expect(result.error).toBe('GitHub unreachable');
    expectPichamberSourcesOnly(fetchMock);
  });

  it('treats an npm failure plus empty GitHub as an error, not latest via OpenChamber', async () => {
    fetchMock
      .when('api.github.com/repos/birdmichael/pichamber/releases/latest', httpStatus(404))
      .when('registry.npmjs.org/@pichamber/web', Promise.reject(new Error('Registry unreachable')));

    const result = await checkForUpdates({ currentVersion: '1.0.0' });

    expect(result.available).toBe(false);
    expect(result.error).toBe('Registry unreachable');
    expectPichamberSourcesOnly(fetchMock);
  });

  it('returns an error when both Pichamber sources fail', async () => {
    fetchMock
      .when('api.github.com/repos/birdmichael/pichamber/releases/latest', Promise.reject(new Error('GitHub unreachable')))
      .when('registry.npmjs.org/@pichamber/web', Promise.reject(new Error('Registry unreachable')));

    const result = await checkForUpdates({ currentVersion: '1.0.0' });

    expect(result.available).toBe(false);
    expect(result.error).toBeTruthy();
    expectPichamberSourcesOnly(fetchMock);
  });

  it('uses @pichamber/web when GitHub has no releases yet', async () => {
    fetchMock
      .when('api.github.com/repos/birdmichael/pichamber/releases/latest', httpStatus(404))
      .when('registry.npmjs.org/@pichamber/web', jsonOk({
        'dist-tags': { latest: '1.1.0' },
      }))
      .when('raw.githubusercontent.com/birdmichael/pichamber', {
        ok: true,
        status: 200,
        text: async () => '## [1.1.0] - 2026-08-16\n\n- First npm publish',
      });

    const result = await checkForUpdates({ currentVersion: '1.0.0' });

    expect(result.available).toBe(true);
    expect(result.version).toBe('1.1.0');
    expect(result.releaseUrl).toBe('https://github.com/birdmichael/pichamber/releases/tag/v1.1.0');
    expectPichamberSourcesOnly(fetchMock);
  });

  it('returns available=false when the current version already matches GitHub latest', async () => {
    fetchMock
      .when('api.github.com/repos/birdmichael/pichamber/releases/latest', jsonOk({
        tag_name: 'v1.0.0',
        html_url: 'https://github.com/birdmichael/pichamber/releases/tag/v1.0.0',
      }))
      .when('registry.npmjs.org/@pichamber/web', jsonOk({
        'dist-tags': { latest: '1.0.0' },
      }));

    const result = await checkForUpdates({ currentVersion: '1.0.0' });

    expect(result.available).toBe(false);
    expect(result.version).toBe('1.0.0');
    expectPichamberSourcesOnly(fetchMock);
  });

  it('does not treat a prerelease as newer than the matching stable version', async () => {
    fetchMock
      .when('api.github.com/repos/birdmichael/pichamber/releases/latest', httpStatus(404))
      .when('registry.npmjs.org/@pichamber/web', jsonOk({
        'dist-tags': { latest: '1.10.0-beta.1' },
      }));

    const result = await checkForUpdates({ currentVersion: '1.10.0' });

    expect(result.available).toBe(false);
  });

  it('resolves an Android APK asset from birdmichael/pichamber', async () => {
    fetchMock
      .when('api.github.com/repos/birdmichael/pichamber/releases/latest', jsonOk({
        tag_name: 'v1.10.0',
        html_url: 'https://github.com/birdmichael/pichamber/releases/tag/v1.10.0',
      }))
      .when('registry.npmjs.org/@pichamber/web', httpStatus(404))
      .when('api.github.com/repos/birdmichael/pichamber/releases/tags/v1.10.0', jsonOk({
        assets: [
          {
            name: 'Pichamber-1.10.0-42-android.aab',
            browser_download_url: 'https://downloads.example/Pichamber-1.10.0-42-android.aab',
          },
          {
            name: 'Pichamber-1.10.0-42-android.apk',
            browser_download_url: 'https://downloads.example/Pichamber-1.10.0-42-android.apk',
          },
        ],
      }));

    const result = await checkForUpdates({
      appType: 'mobile-capacitor',
      platform: 'android',
      currentVersion: '1.9.10',
    });

    expect(result.downloadUrl).toBe('https://downloads.example/Pichamber-1.10.0-42-android.apk');
    expect(result.releaseUrl).toBe('https://github.com/birdmichael/pichamber/releases/tag/v1.10.0');
    expectPichamberSourcesOnly(fetchMock);
  });

  it('uses PICHAMBER_UPDATE_API_URL when set and never the OpenChamber default', async () => {
    process.env.PICHAMBER_UPDATE_API_URL = 'https://updates.example.test/v1/update/check';
    fetchMock.when('updates.example.test/v1/update/check', jsonOk({
      latestVersion: '1.10.0',
      updateAvailable: true,
      releaseNotes: '## [1.10.0]\n\n- Self-hosted check',
      releaseNotesUrl: 'https://github.com/birdmichael/pichamber/releases/tag/v1.10.0',
    }));

    const result = await checkForUpdates({
      appType: 'desktop-electron',
      currentVersion: '1.9.10',
      installId: '4f4dfead-9688-4c4f-97d7-4607fbbfc3ab',
      platform: 'windows',
      arch: 'arm64',
    });

    expect(result.available).toBe(true);
    expect(result.version).toBe('1.10.0');
    expect(result.updateCommand).toBe('pichamber update');
    expect(fetchedUrls(fetchMock)).toEqual([
      'https://updates.example.test/v1/update/check',
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      installId: '4f4dfead-9688-4c4f-97d7-4607fbbfc3ab',
      platform: 'windows',
      arch: 'arm64',
    });
    expectPichamberSourcesOnly(fetchMock);
  });

  it('accepts deprecated OPENCHAMBER_UPDATE_API_URL as an override alias', async () => {
    process.env.OPENCHAMBER_UPDATE_API_URL = 'https://legacy-updates.example.test/v1/update/check';
    fetchMock.when('legacy-updates.example.test/v1/update/check', jsonOk({
      latestVersion: '1.4.0',
      updateAvailable: true,
    }));

    const result = await checkForUpdates({
      appType: 'desktop-electron',
      currentVersion: '1.0.0',
    });

    expect(result.available).toBe(true);
    expect(result.version).toBe('1.4.0');
    expect(result.releaseUrl).toBe('https://github.com/birdmichael/pichamber/releases/tag/v1.4.0');
    expect(fetchedUrls(fetchMock)[0]).toContain('legacy-updates.example.test');
    expectPichamberSourcesOnly(fetchMock);
  });
});

describe('getCurrentVersion', () => {
  it('is exported for the CLI update command', () => {
    expect(typeof getCurrentVersion).toBe('function');
    expect(getCurrentVersion()).toMatch(/^\d+\.\d+\.\d+|unknown$/);
  });
});

describe('CLI update exports', () => {
  it('exports package-manager helpers used by the update command', () => {
    expect(typeof detectPackageManager).toBe('function');
    expect(typeof executeUpdate).toBe('function');
  });

  it('installs @pichamber/web and never @openchamber/web', () => {
    expect(getUpdateCommand('npm')).toMatch(/npm install -g @pichamber\/web@latest$/);
    expect(getUpdateCommand('bun')).toMatch(/bun add -g @pichamber\/web@latest$/);
    expect(getUpdateCommand('pnpm')).toMatch(/pnpm add -g @pichamber\/web@latest$/);
    expect(getUpdateCommand('yarn')).toMatch(/yarn global add @pichamber\/web@latest$/);
    expect(getUpdateCommand('npm')).not.toContain('@openchamber/web');
    expect(getUpdateCommand('bun')).not.toContain('@openchamber/web');
  });
});
