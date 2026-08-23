import { beforeEach, describe, expect, mock, test } from "bun:test"

const toastInfo = mock((_title: string, _options?: unknown) => undefined)
const openSessionFromToast = mock((_sessionId: string, _directory: string) => undefined)

mock.module("@/components/ui", () => ({
  toast: {
    info: toastInfo,
  },
}))

mock.module("@/lib/i18n", () => ({
  formatMessage: (_dictionary: unknown, key: string) => key,
  useI18nStore: {
    getState: () => ({ dictionary: {} }),
  },
}))

mock.module("./session-navigation", () => ({
  openSessionFromToast,
}))

const {
  KERNEL_RELOAD_INTERRUPTED_KIND,
  KERNEL_RELOAD_INTERRUPTED_TOAST_ID,
  showKernelReloadInterruptedToast,
} = await import("./kernel-reload-interrupted-toast")

describe("showKernelReloadInterruptedToast", () => {
  beforeEach(() => {
    toastInfo.mockClear()
    openSessionFromToast.mockClear()
  })

  test("shows a sticky continue toast without an action when the session is unknown", () => {
    showKernelReloadInterruptedToast({})

    expect(toastInfo).toHaveBeenCalledTimes(1)
    expect(toastInfo).toHaveBeenCalledWith("chat.toast.opencodeRestartInterrupted.title", {
      id: KERNEL_RELOAD_INTERRUPTED_TOAST_ID,
      description: "chat.toast.opencodeRestartInterrupted.description",
      duration: Infinity,
    })
  })

  test("adds Open session when both session and directory are present", () => {
    showKernelReloadInterruptedToast({ sessionId: "ses_1", directory: "/tmp/project" })

    expect(toastInfo).toHaveBeenCalledTimes(1)
    const options = toastInfo.mock.calls[0]?.[1] as {
      action?: { label?: string; onClick?: () => void }
    }
    expect(options.action?.label).toBe("chat.toast.opencodeRestartInterrupted.openSession")
    options.action?.onClick?.()
    expect(openSessionFromToast).toHaveBeenCalledWith("ses_1", "/tmp/project")
  })

  test("keeps the official notification kind", () => {
    expect(KERNEL_RELOAD_INTERRUPTED_KIND).toBe("opencode-restart-interrupted")
  })
})
