export const sessionTranscriptHasChrome = ({
  messageCount,
  sessionIsWorking,
  questionCount,
  permissionCount,
  transcriptPromptCount,
  waitingForAuthoritativePrompts = false,
}: {
  messageCount: number;
  sessionIsWorking: boolean;
  questionCount: number;
  permissionCount: number;
  transcriptPromptCount: number;
  waitingForAuthoritativePrompts?: boolean;
}): boolean => (
  messageCount > 0
  || sessionIsWorking
  || questionCount > 0
  || permissionCount > 0
  || transcriptPromptCount > 0
  || waitingForAuthoritativePrompts
);
