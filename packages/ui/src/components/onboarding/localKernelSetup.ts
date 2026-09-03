import { isLocalKernelReady, type KernelHealthSnapshot } from '@/lib/kernelHealth';

export const OPENCODE_INSTALL_COMMAND = 'curl -fsSL https://opencode.ai/install | bash';
const OPENCODE_DOCS_URL = 'https://opencode.ai/docs';
export const PI_INSTALL_COMMAND = 'npm install -g @earendil-works/pi-coding-agent';
const PI_DOCS_URL = 'https://github.com/earendil-works/pi';

export type LocalKernelName = 'pi' | 'opencode';
export type OnboardingPlatform = 'macos' | 'linux' | 'windows' | 'unknown';

export type LocalKernelSetup = {
  kernel: LocalKernelName;
  installCommand: string;
  docsUrl: string;
  binaryName: 'pi' | 'opencode';
};

export type LocalKernelHealth = {
  kernel: LocalKernelName;
  ready: boolean;
  piBinaryResolved: string | null;
  piBinarySource: string | null;
};

export const resolveLocalKernelName = (kernel: unknown): LocalKernelName => (
  kernel === 'opencode' ? 'opencode' : 'pi'
);

export const localKernelSetup = (kernel: unknown): LocalKernelSetup => {
  if (resolveLocalKernelName(kernel) === 'opencode') {
    return {
      kernel: 'opencode',
      installCommand: OPENCODE_INSTALL_COMMAND,
      docsUrl: OPENCODE_DOCS_URL,
      binaryName: 'opencode',
    };
  }
  return {
    kernel: 'pi',
    installCommand: PI_INSTALL_COMMAND,
    docsUrl: PI_DOCS_URL,
    binaryName: 'pi',
  };
};

export const kernelBinaryPlaceholder = (
  kernel: unknown,
  platform: OnboardingPlatform,
): string => {
  const binaryName = localKernelSetup(kernel).binaryName;
  if (platform === 'windows') {
    return `C:\\Users\\you\\AppData\\Roaming\\npm\\${binaryName}.cmd`;
  }
  const home = platform === 'linux' ? '/home/you' : '/Users/you';
  return `${home}/.bun/bin/${binaryName}`;
};

export const readLocalKernelHealth = (health: unknown): LocalKernelHealth => {
  const record = health && typeof health === 'object'
    ? health as Record<string, unknown>
    : {};
  const kernel = resolveLocalKernelName(record.kernel);
  const piBinaryResolved = kernel === 'pi' && typeof record.piBinaryResolved === 'string'
    ? record.piBinaryResolved.trim()
    : '';
  const piBinarySource = kernel === 'pi' && typeof record.piBinarySource === 'string'
    ? record.piBinarySource.trim()
    : '';
  return {
    kernel,
    ready: isLocalKernelReady(health as KernelHealthSnapshot),
    piBinaryResolved: piBinaryResolved || null,
    piBinarySource: piBinarySource || null,
  };
};
