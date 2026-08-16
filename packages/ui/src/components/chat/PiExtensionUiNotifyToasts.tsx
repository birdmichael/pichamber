import React from 'react';

import {
  consumePiExtensionUiNotifies,
  presentPiExtensionUiNotify,
  usePiExtensionUiStore,
} from '@/sync/pi-extension-ui-store';

export function PiExtensionUiNotifyToasts() {
  const notifies = usePiExtensionUiStore((state) => state.notifies);

  React.useEffect(() => {
    if (notifies.length === 0) return;
    for (const notify of notifies) {
      presentPiExtensionUiNotify(notify);
    }
    consumePiExtensionUiNotifies(notifies.map((notify) => notify.id));
  }, [notifies]);

  return null;
}
