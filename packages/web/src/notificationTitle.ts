export const DEFAULT_NOTIFICATION_TITLE = 'Pichamber';

export const notificationTitleFromPayload = (payload: { title?: string }): string =>
  payload.title || DEFAULT_NOTIFICATION_TITLE;

