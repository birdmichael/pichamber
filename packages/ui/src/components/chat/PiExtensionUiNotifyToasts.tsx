import React from 'react';

import { toast } from '@/components/ui';
import {
  consumePiExtensionUiNotifies,
  usePiExtensionUiStore,
} from '@/sync/pi-extension-ui-store';

export function PiExtensionUiNotifyToasts() {
  const notifies = usePiExtensionUiStore((state) => state.notifies);

  React.useEffect(() => {
    if (notifies.length === 0) return;
    for (const notify of notifies) {
      if (notify.level === 'error') toast.error(notify.message);
      else if (notify.level === 'warning') toast.warning(notify.message);
      else toast.info(notify.message);
    }
    consumePiExtensionUiNotifies(notifies.map((notify) => notify.id));
  }, [notifies]);

  return null;
}
