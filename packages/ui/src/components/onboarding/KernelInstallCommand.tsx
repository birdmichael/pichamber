import { Icon } from '@/components/icon/Icon';
import { OPENCODE_INSTALL_COMMAND } from './localKernelSetup';

type KernelInstallCommandProps = {
  command: string;
  copyTitle: string;
  onCopy: () => void;
  layout?: 'chooser' | 'local-setup';
};

function OpenCodeBashCommand({
  onCopy,
  copyTitle,
  layout,
}: {
  onCopy: () => void;
  copyTitle: string;
  layout: 'chooser' | 'local-setup';
}) {
  const chooser = layout === 'chooser';
  return (
    <div className={chooser ? 'flex items-center justify-between gap-3 w-full' : 'flex items-center justify-center gap-3'}>
      <code className={chooser ? 'flex-1 text-left overflow-x-auto whitespace-nowrap' : undefined}>
        <span style={{ color: 'var(--syntax-keyword)' }}>curl</span>
        <span className="text-muted-foreground"> -fsSL </span>
        <span style={{ color: 'var(--syntax-string)' }}>https://opencode.ai/install</span>
        <span className="text-muted-foreground"> | </span>
        <span style={{ color: 'var(--syntax-keyword)' }}>bash</span>
      </code>
      <button
        type="button"
        onClick={onCopy}
        className={chooser
          ? 'inline-flex items-center text-muted-foreground hover:text-foreground transition-colors shrink-0'
          : 'inline-flex items-center text-muted-foreground hover:text-foreground transition-colors'}
        title={copyTitle}
        aria-label={copyTitle}
      >
        <Icon name="file-copy" className="h-4 w-4" />
      </button>
    </div>
  );
}

export function KernelInstallCommand({
  command,
  copyTitle,
  onCopy,
  layout = 'chooser',
}: KernelInstallCommandProps) {
  if (command === OPENCODE_INSTALL_COMMAND) {
    return <OpenCodeBashCommand onCopy={onCopy} copyTitle={copyTitle} layout={layout} />;
  }

  const chooser = layout === 'chooser';
  return (
    <div className={chooser ? 'flex items-center justify-between gap-3 w-full' : 'flex items-center justify-center gap-3'}>
      <code className={chooser ? 'flex-1 text-left overflow-x-auto whitespace-nowrap' : undefined}>
        {command}
      </code>
      <button
        type="button"
        onClick={onCopy}
        className={chooser
          ? 'inline-flex items-center text-muted-foreground hover:text-foreground transition-colors shrink-0'
          : 'inline-flex items-center text-muted-foreground hover:text-foreground transition-colors'}
        title={copyTitle}
        aria-label={copyTitle}
      >
        <Icon name="file-copy" className="h-4 w-4" />
      </button>
    </div>
  );
}
