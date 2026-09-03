import React from 'react';

import { Icon } from '@/components/icon/Icon';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useI18n } from '@/lib/i18n';

import { handleFilesTreePaneContextMenu } from './filesTreeEmptyPaneContextMenu';

type FilesTreeEmptyPaneMenuProps = {
  enabled?: boolean;
  canCreateFile: boolean;
  canCreateFolder: boolean;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  children: React.ReactNode;
};

export const FilesTreeEmptyPaneMenu: React.FC<FilesTreeEmptyPaneMenuProps> = ({
  enabled = true,
  canCreateFile,
  canCreateFolder,
  onCreateFile,
  onCreateFolder,
  children,
}) => {
  const { t } = useI18n();
  const canOpenRootMenu = canCreateFile || canCreateFolder;
  const [open, setOpen] = React.useState(false);

  const handleContextMenu = React.useCallback((event: React.MouseEvent) => {
    const action = handleFilesTreePaneContextMenu(event, { canOpenRootMenu });
    setOpen(action === 'root-menu');
  }, [canOpenRootMenu]);

  if (!enabled) {
    return children;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ContextMenu
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
      >
        <ContextMenuTrigger
          render={(
            <div
              className="flex min-h-0 flex-1 flex-col"
              data-files-tree-pane=""
              onContextMenu={handleContextMenu}
            />
          )}
        >
          {children}
        </ContextMenuTrigger>
        {canOpenRootMenu ? (
          <ContextMenuContent className="min-w-[180px]">
            {canCreateFile ? (
              <ContextMenuItem onClick={onCreateFile}>
                <Icon name="file-add" className="mr-2 size-4" /> {t('sidebarFilesTree.menu.newFile')}
              </ContextMenuItem>
            ) : null}
            {canCreateFolder ? (
              <ContextMenuItem onClick={onCreateFolder}>
                <Icon name="folder-add" className="mr-2 size-4" /> {t('sidebarFilesTree.menu.newFolder')}
              </ContextMenuItem>
            ) : null}
          </ContextMenuContent>
        ) : null}
      </ContextMenu>
    </div>
  );
};
