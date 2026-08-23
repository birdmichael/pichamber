import { toast } from "@/components/ui"
import { formatMessage, useI18nStore } from "@/lib/i18n"
import { openSessionFromToast } from "./session-navigation"

export const KERNEL_RELOAD_INTERRUPTED_KIND = "opencode-restart-interrupted"
export const KERNEL_RELOAD_INTERRUPTED_TOAST_ID = "opencode-restart-interrupted"

export function showKernelReloadInterruptedToast(input: {
  sessionId?: string
  directory?: string
}): void {
  const dictionary = useI18nStore.getState().dictionary
  const title = formatMessage(dictionary, "chat.toast.opencodeRestartInterrupted.title")
  const options = {
    id: KERNEL_RELOAD_INTERRUPTED_TOAST_ID,
    description: formatMessage(dictionary, "chat.toast.opencodeRestartInterrupted.description"),
    duration: Infinity,
  }
  const sessionId = input.sessionId
  const directory = input.directory
  if (sessionId && directory) {
    toast.info(title, {
      ...options,
      action: {
        label: formatMessage(dictionary, "chat.toast.opencodeRestartInterrupted.openSession"),
        onClick: () => openSessionFromToast(sessionId, directory),
      },
    })
    return
  }
  toast.info(title, options)
}
