import React from 'react';

import { cn } from '@/lib/utils';
import { splitGitChangePath } from './splitGitChangePath';

type GitChangePathProps = {
  path: string;
  className?: string;
};

const rtlTruncateStyle: React.CSSProperties = { direction: 'rtl', textAlign: 'left' };
const ltrIsolateStyle: React.CSSProperties = { direction: 'ltr', unicodeBidi: 'isolate' };

/**
 * Keep the filename readable in a narrow Git change row.
 * The parent path yields space first and left-truncates. The name is
 * shrink-0 / nowrap while any directory still has room; only after the
 * directory is gone may the name left-truncate so the tail stays visible.
 */
export function GitChangePath({ path, className }: GitChangePathProps) {
  const { dir, name } = splitGitChangePath(path);
  const displayName = dir === '' ? `/${name}` : name;

  if (!dir) {
    return (
      <span
        className={cn('min-w-0 flex-1 overflow-hidden text-ellipsis typography-ui-label text-foreground', className)}
        style={rtlTruncateStyle}
        title={path}
      >
        <span className="shrink-0 whitespace-nowrap" style={ltrIsolateStyle}>
          {displayName}
        </span>
      </span>
    );
  }

  return (
    <span className={cn('flex min-w-0 flex-1 items-baseline', className)} title={path}>
      <span
        className="min-w-0 flex-1 truncate typography-ui-label text-muted-foreground"
        style={rtlTruncateStyle}
      >
        <span style={ltrIsolateStyle}>{dir}</span>
      </span>
      <span
        className="min-w-0 shrink overflow-hidden text-ellipsis typography-ui-label"
        style={rtlTruncateStyle}
      >
        <span className="shrink-0 whitespace-nowrap" style={ltrIsolateStyle}>
          <span className="text-muted-foreground">/</span>
          <span className="text-foreground">{name}</span>
        </span>
      </span>
    </span>
  );
}
