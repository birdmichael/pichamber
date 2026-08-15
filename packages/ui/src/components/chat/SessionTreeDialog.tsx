import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { forkFromMessage } from '@/sync/session-actions';

type TreeNode = {
  id: string;
  parentId: string | null;
  role: string;
  preview: string;
  timestamp: number;
};

export const SessionTreeDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
}> = ({ open, onOpenChange, sessionId }) => {
  const { t } = useI18n();
  const [nodes, setNodes] = React.useState<TreeNode[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    setLoading(true);
    void runtimeFetch(`/api/session/${sessionId}/tree`, { headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : []))
      .then((payload) => {
        if (!cancelled) setNodes(Array.isArray(payload) ? payload : []);
      })
      .catch(() => {
        if (!cancelled) setNodes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, sessionId]);

  const userNodes = nodes.filter((node) => node.role === 'user');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('chat.sessionTree.title')}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="typography-ui text-muted-foreground">{t('chat.sessionTree.loading')}</p>
        ) : userNodes.length === 0 ? (
          <p className="typography-ui text-muted-foreground">{t('chat.sessionTree.empty')}</p>
        ) : (
          <ul className="max-h-[50vh] space-y-1 overflow-auto">
            {userNodes.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  className="w-full rounded-lg px-3 py-2 text-left typography-ui hover:bg-interactive-selection"
                  onClick={() => {
                    if (!sessionId) return;
                    void forkFromMessage(sessionId, node.id);
                    onOpenChange(false);
                  }}
                >
                  <div className="truncate">{node.preview || node.id}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
};
