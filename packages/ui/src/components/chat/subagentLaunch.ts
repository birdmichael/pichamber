export type SubagentModelSelection = {
  providerId: string;
  modelId: string;
};

export const parseSubagentModelRef = (value: string | null | undefined): SubagentModelSelection | null => {
  const ref = typeof value === 'string' ? value.trim() : '';
  const slash = ref.indexOf('/');
  if (slash <= 0 || slash >= ref.length - 1) return null;
  const providerId = ref.slice(0, slash).trim();
  const modelId = ref.slice(slash + 1).trim();
  return providerId && modelId ? { providerId, modelId } : null;
};

export const buildSubagentRunArguments = ({
  role,
  providerId,
  modelId,
  thinking,
  task,
}: {
  role: string;
  providerId: string;
  modelId: string;
  thinking: string;
  task: string;
}): string => `${role}[model=${providerId}/${modelId}:${thinking}] ${JSON.stringify(task)} --bg`;

export const canLaunchSubagent = ({
  task,
  sessionId,
  model,
  modelConfirmed,
}: {
  task: string | null | undefined;
  sessionId: string | null | undefined;
  model: string | null | undefined;
  modelConfirmed: boolean;
}): boolean => Boolean(task?.trim() && sessionId?.trim() && modelConfirmed && parseSubagentModelRef(model));
