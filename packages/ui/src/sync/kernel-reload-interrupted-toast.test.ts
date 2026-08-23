import { beforeEach, describe, expect, mock, test } from "bun:test"

const toastInfoCalls: Array<{ title: string; options?: unknown }> = []
const openSessionCalls: Array<{ sessionId: string; directory: string }> = []

mock.module("@/components/ui", () => ({
  toast: {
    info: (title: string, options?: unknown) => {
      toastInfoCalls.push({ title, options })
    },
  },
}))

mock.module("@/lib/i18n", () => ({
  formatMessage: (_dictionary: unknown, key: string) => key,
  useI18nStore: {
    getState: () => ({ dictionary: {} }),
  },
}))

mock.module("./session-navigation", () => ({
  openSessionFromToast: (sessionId: string, directory: string) => {
    openSessionCalls.push({ sessionId, directory })
  },
}))

const {
  KERNEL_RELOAD_INTERRUPTED_KIND,
  KERNEL_RELOAD_INTERRUPTED_TOAST_ID,
  showKernelReloadInterruptedToast,
} = await import("./kernel-reload-interrupted-toast")

describe("showKernelReloadInterruptedToast", () => {
  beforeEach(() => {
    toastInfoCalls.length = 0
    openSessionCalls.length = 0
  })

  test("shows a sticky continue toast without an action when the session is unknown", () => {
    showKernelReloadInterruptedToast({})

    expect(toastInfoCalls).toEqual([{
      title: "chat.toast.opencodeRestartInterrupted.title",
      options: {
        id: KERNEL_RELOAD_INTERRUPTED_TOAST_ID,
        description: "chat.toast.opencodeRestartInterrupted.description",
        duration: Infinity,
      },
    }])
  })

  test("adds Open session when both session and directory are present", () => {
    showKernelReloadInterruptedToast({ sessionId: "ses_1", directory: "/tmp/project" })

    expect(toastInfoCalls).toHaveLength(1)
    const options = toastInfoCalls[0]?.options as {
      action?: { label?: string; onClick?: () => void }
    }
    expect(options.action?.label).toBe("chat.toast.opencodeRestartInterrupted.openSession")
    options.action?.onClick?.()
    expect(openSessionCalls).toEqual([{ sessionId: "ses_1", directory: "/tmp/project" }])
  })

  test("keeps the official notification kind", () => {
    expect(KERNEL_RELOAD_INTERRUPTED_KIND).toBe("opencode-restart-interrupted")
  })
})
