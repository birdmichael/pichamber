import { applySessionPlanEvent } from './pi-session-plan-store';

export const isPiSessionPlanEventType = (type: unknown): boolean => type === 'pi.plan.updated';

export const handlePiSessionPlanEvent = (payload: { type?: unknown; properties?: unknown }): boolean => {
  if (!isPiSessionPlanEventType(payload.type)) return false;
  applySessionPlanEvent(payload.properties);
  return true;
};
