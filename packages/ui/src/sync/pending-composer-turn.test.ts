import { describe, expect, test } from "bun:test"

import {
  beginPendingComposerTurn,
  clearPendingComposerTurn,
  getPendingComposerTurn,
  pendingComposerDraftKey,
  pendingComposerSessionKey,
  retargetPendingComposerTurn,
} from "./pending-composer-turn"

describe("pending composer turn", () => {
  test("begin then clear removes the pending turn", () => {
    const key = pendingComposerDraftKey(3)
    beginPendingComposerTurn({ key, text: "hello" })
    expect(getPendingComposerTurn()?.text).toBe("hello")
    expect(getPendingComposerTurn()?.key).toBe(key)
    clearPendingComposerTurn(key)
    expect(getPendingComposerTurn()).toBe(null)
  })

  test("clear with a different key leaves the pending turn", () => {
    const key = pendingComposerDraftKey(4)
    beginPendingComposerTurn({ key, text: "stay" })
    clearPendingComposerTurn(pendingComposerSessionKey("ses_other"))
    expect(getPendingComposerTurn()?.text).toBe("stay")
    clearPendingComposerTurn(key)
  })

  test("retarget moves the pending turn onto the created session key", () => {
    const draftKey = pendingComposerDraftKey(9)
    const sessionKey = pendingComposerSessionKey("ses_1")
    beginPendingComposerTurn({ key: draftKey, text: "first" })
    retargetPendingComposerTurn(draftKey, sessionKey)
    expect(getPendingComposerTurn()?.key).toBe(sessionKey)
    expect(getPendingComposerTurn()?.text).toBe("first")
    clearPendingComposerTurn(sessionKey)
  })

  test("retarget ignores a stale draft key", () => {
    beginPendingComposerTurn({ key: pendingComposerDraftKey(1), text: "a" })
    retargetPendingComposerTurn(pendingComposerDraftKey(2), pendingComposerSessionKey("ses_x"))
    expect(getPendingComposerTurn()?.key).toBe(pendingComposerDraftKey(1))
    clearPendingComposerTurn()
  })
})
