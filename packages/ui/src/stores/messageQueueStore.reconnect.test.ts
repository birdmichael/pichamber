import { beforeEach, describe, expect, test } from "bun:test"
import {
  createMessageQueueTarget,
  getMessageQueueKey,
  useMessageQueueStore,
} from "./messageQueueStore"

describe("messageQueueStore.reconcileAfterReconnect", () => {
  beforeEach(() => {
    useMessageQueueStore.setState({
      queuedMessages: {},
      quarantinedLegacyMessages: {},
      sendingIds: {},
      followUpBehavior: "queue",
    })
  })

  test("drops queued items whose text is already in the session transcript", () => {
    const target = createMessageQueueTarget("ses_1", "/repo", "runtime-a")
    if (!target) throw new Error("missing target")
    const key = getMessageQueueKey(target)
    useMessageQueueStore.setState({
      queuedMessages: {
        [key]: [
          { id: "q1", content: "already sent", createdAt: 1 },
          { id: "q2", content: "still waiting", createdAt: 2 },
        ],
      },
      sendingIds: { [key]: ["q1"] },
    })

    useMessageQueueStore.getState().reconcileAfterReconnect(
      "runtime-a",
      new Map([["ses_1", new Set(["already sent"])]]),
    )

    expect(useMessageQueueStore.getState().queuedMessages[key]?.map((m) => m.id)).toEqual(["q2"])
    expect(useMessageQueueStore.getState().sendingIds[key]).toBeUndefined()
  })

  test("ignores other runtimes", () => {
    const target = createMessageQueueTarget("ses_1", "/repo", "runtime-b")
    if (!target) throw new Error("missing target")
    const key = getMessageQueueKey(target)
    useMessageQueueStore.setState({
      queuedMessages: {
        [key]: [{ id: "q1", content: "keep", createdAt: 1 }],
      },
    })
    useMessageQueueStore.getState().reconcileAfterReconnect(
      "runtime-a",
      new Map([["ses_1", new Set(["keep"])]]),
    )
    expect(useMessageQueueStore.getState().queuedMessages[key]?.[0]?.id).toBe("q1")
  })
})
