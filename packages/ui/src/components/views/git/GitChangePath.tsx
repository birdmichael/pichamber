import React from 'react';

import { cn } from '@/lib/utils';

export function splitGitChangePath(path: string): { dir: string | null; name: string } {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash === -1) {
    return { dir: null, name: path };
  }
  return {
    dir: path.slice(0, lastSlash),
    name: path.slice(lastSlash + 1),
  };
}

type GitChangePathProps = {
  path: string;
  className?: string;
};

/**
 * Keep the filename readable in a narrow Git change row.
 * The parent path yields space first and left-truncates; the name only
 * ellipsizes after the parent is gone.
 */
export function GitChangePath({ path, className }: GitChangePathProps) {
  const { dir, name } = splitGitChangePath(path);

  if (!dir) {
    return (
      <span
        className={cn('min-w-0 flex-1 truncate typography-ui-label text-foreground', className)}
        title={path}
      >
        {dir === '' ? `/${name}` : name}
      </span>
    );
  }

  return (
    <span className={cn('flex min-w-0 flex-1 items-baseline', className)} title={path}>
      <span
        className="min-w-0 flex-1 truncate typography-ui-label text-muted-foreground"
        style={{ direction: 'rtl', textAlign: 'left' }}
      >
        <span style={{ direction: 'ltr', unicodeBidi: 'isolate' }}>{dir}</span>
      </span>
      <span className="min-w-0 max-w-full shrink-0 truncate typography-ui-label">
        <span className="text-muted-foreground">/</span>
        <span className="text-foreground">{name}</span>
      </span>
    </span>
  );
}
