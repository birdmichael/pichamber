import React from 'react';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { useI18n } from '@/lib/i18n';

export const ContextUsageChip: React.FC<{ sessionId: string | null }> = ({ sessionId }) => {
  const { t } = useI18n();
  const [percent, setPercent] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!sessionId) {
      setPercent(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const response = await runtimeFetch(`/api/session/${sessionId}/usage`, { headers: { Accept: 'application/json' } });
        if (!response.ok) return;
        const data = await response.json() as { available?: boolean; percent?: number; tokens?: number; contextLimit?: number };
        if (cancelled || data.available === false) return;
        if (typeof data.percent === 'number') {
          setPercent(Math.max(0, Math.min(100, Math.round(data.percent))));
          return;
        }
        if (typeof data.tokens === 'number' && typeof data.contextLimit === 'number' && data.contextLimit > 0) {
          setPercent(Math.max(0, Math.min(100, Math.round((data.tokens / data.contextLimit) * 100))));
        }
      } catch {
        // best effort
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionId]);

  if (percent == null) return null;
  return (
    <span className="typography-meta text-muted-foreground tabular-nums" title={t('chat.contextUsage.label')}>
      {percent}%
    </span>
  );
};
