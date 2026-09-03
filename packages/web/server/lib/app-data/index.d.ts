export const PICHAMBER_DATA_DIR_ENV: 'PICHAMBER_DATA_DIR';
export const OPENCHAMBER_DATA_DIR_ENV: 'OPENCHAMBER_DATA_DIR';
export const APP_DATA_DIR_NAME: 'pichamber';
export const LEGACY_APP_DATA_DIR_NAME: 'openchamber';

export type AppDataFs = {
  lstatSync(target: string): { isDirectory(): boolean; isSymbolicLink(): boolean; size: number };
  readdirSync(target: string): string[];
  readlinkSync(target: string): string;
  cpSync(source: string, dest: string, options?: object): void;
  renameSync(source: string, dest: string): void;
  rmSync(target: string, options?: object): void;
};

export type ResolveAppDataDirOptions = {
  env?: NodeJS.ProcessEnv;
  home?: string;
  fs?: AppDataFs;
  migrate?: boolean;
};

export function defaultAppDataDir(home?: string): string;
export function legacyAppDataDir(home?: string): string;
export function resolveOverrideDataDir(env?: NodeJS.ProcessEnv): string | null;
export function isManagedChatsPath(value: string | null | undefined): boolean;
export function resetAppDataDirCacheForTests(): void;
export function resolveAppDataDir(options?: ResolveAppDataDirOptions): string;
