import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { OpencodeClient, Session } from "@opencode-ai/sdk/v2"

import { opencodeClient } from "@/lib/opencode/client"
import {
  setGlobalSessionsPiKernelForTests,
  useGlobalSessionsStore,
} from "./useGlobalSessionsStore"

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let listRequest: Deferred<Session[]>
let listCalls: Array<Record<string, unknown>>

// OpenCode issues one inclusive (`archived: true`) paginated request per
// load/refresh scope and splits active/archived client-side, so restored
// sessions (`time.archived` falsy-but-present) stay visible in the active
// list. Pi daily loads use `archived: false` and fetch archived only when
// Archive / the VS Code archived bucket opens. The mock serves that request.
const sdk = {
  experimental: {
    session: {
      list: async (options: Record<string, unknown> = {}) => {
        listCalls.push(options)
        return {
          data: await listRequest.promise,
          response: { headers: new Headers() },
        }
      },
    },
  },
} as unknown as OpencodeClient
const originalGetSdkClient = opencodeClient.getSdkClient

const session = (id: string, title = id, archived?: number): Session => ({
  id,
  title,
  time: { created: 1, updated: 1, ...(archived !== undefined ? { archived } : {}) },
} as Session)

describe("global session mutation reconciliation", () => {
  beforeEach(() => {
    listRequest = deferred<Session[]>()
    listCalls = []
    setGlobalSessionsPiKernelForTests(false)
    opencodeClient.getSdkClient = () => sdk
    useGlobalSessionsStore.getState().resetForRuntimeSwitch()
  })

  afterEach(() => {
    setGlobalSessionsPiKernelForTests(null)
    opencodeClient.getSdkClient = originalGetSdkClient
  })

  test("keeps a session created after a full load starts", async () => {
    const loading = useGlobalSessionsStore.getState().loadSessions()
    useGlobalSessionsStore.getState().upsertSession(session("created"))

    listRequest.resolve([])
    await loading

    expect(useGlobalSessionsStore.getState().activeSessions.map((item) => item.id)).toEqual(["created"])
  })

  test("does not resurrect a session deleted after a full load starts", async () => {
    const stale = session("deleted")
    useGlobalSessionsStore.getState().applySnapshot([stale], [])
    const loading = useGlobalSessionsStore.getState().loadSessions()
    useGlobalSessionsStore.getState().removeSessions([stale.id])

    listRequest.resolve([stale])
    await loading

    expect(useGlobalSessionsStore.getState().activeSessions).toEqual([])
    expect(useGlobalSessionsStore.getState().archivedSessions).toEqual([])
  })

  test("keeps an archive mutation newer than both list requests", async () => {
    const stale = session("archived")
    useGlobalSessionsStore.getState().applySnapshot([stale], [])
    const loading = useGlobalSessionsStore.getState().loadSessions()
    useGlobalSessionsStore.getState().archiveSessions([stale.id], 10)

    listRequest.resolve([stale])
    await loading

    expect(useGlobalSessionsStore.getState().activeSessions).toEqual([])
    expect(useGlobalSessionsStore.getState().archivedSessions[0]?.time.archived).toBe(10)
  })

  test("keeps a newer title when an older response finishes last", async () => {
    const stale = session("updated", "Old")
    useGlobalSessionsStore.getState().applySnapshot([stale], [])
    const loading = useGlobalSessionsStore.getState().loadSessions()
    useGlobalSessionsStore.getState().upsertSession(session("updated", "New"))

    listRequest.resolve([stale])
    await loading

    expect(useGlobalSessionsStore.getState().activeSessions[0]?.title).toBe("New")
  })

  test("uses commit-time state when the load fails", async () => {
    const created = session("created")
    const loading = useGlobalSessionsStore.getState().loadSessions()
    useGlobalSessionsStore.getState().upsertSession(created)

    listRequest.reject(new Error("unavailable"))
    await loading

    expect(useGlobalSessionsStore.getState().activeSessions).toEqual([created])
    expect(useGlobalSessionsStore.getState().status).toBe("error")
  })

  test("splits a restored session into the active list", async () => {
    const loading = useGlobalSessionsStore.getState().loadSessions()

    listRequest.resolve([session("active"), session("archived", "archived", 5), session("restored", "restored", 0)])
    await loading

    expect(useGlobalSessionsStore.getState().activeSessions.map((item) => item.id)).toEqual(["active", "restored"])
    expect(useGlobalSessionsStore.getState().archivedSessions.map((item) => item.id)).toEqual(["archived"])
    expect(useGlobalSessionsStore.getState().status).toBe("ready")
  })

  test("does not undo a move while refreshing the source directory", async () => {
    const source = { ...session("moved"), directory: "/source" } as Session
    const destination = { ...source, directory: "/destination" } as Session
    useGlobalSessionsStore.getState().applySnapshot([source], [])
    const refreshing = useGlobalSessionsStore.getState().refreshSessionsForDirectories(["/source"])
    useGlobalSessionsStore.getState().upsertSession(destination)

    listRequest.resolve([source])
    await refreshing

    expect(useGlobalSessionsStore.getState().sessionsByDirectory.get("/source")).toBe(undefined)
    expect(useGlobalSessionsStore.getState().sessionsByDirectory.get("/destination")?.[0]?.id).toBe("moved")
  })

  test("keeps a restore mutation newer than the directory refresh", async () => {
    const archived = { ...session("restored", "restored", 5), directory: "/source" } as Session
    useGlobalSessionsStore.getState().applySnapshot([], [archived])
    const refreshing = useGlobalSessionsStore.getState().refreshSessionsForDirectories(["/source"])
    useGlobalSessionsStore.getState().upsertSession({ ...archived, time: { ...archived.time, archived: 0 } })

    // The server still reports the pre-restore row for this directory.
    listRequest.resolve([archived])
    await refreshing

    expect(useGlobalSessionsStore.getState().activeSessions.map((item) => item.id)).toEqual(["restored"])
    expect(useGlobalSessionsStore.getState().archivedSessions).toEqual([])
  })
})

describe("global session archived query by kernel", () => {
  beforeEach(() => {
    listRequest = deferred<Session[]>()
    listCalls = []
    opencodeClient.getSdkClient = () => sdk
    useGlobalSessionsStore.getState().resetForRuntimeSwitch()
  })

  afterEach(() => {
    setGlobalSessionsPiKernelForTests(null)
    opencodeClient.getSdkClient = originalGetSdkClient
  })

  test("Pi default global load does not pass archived: true", async () => {
    setGlobalSessionsPiKernelForTests(true)
    const loading = useGlobalSessionsStore.getState().loadSessions()
    listRequest.resolve([session("active"), session("restored", "restored", 0)])
    await loading

    expect(listCalls).toHaveLength(1)
    expect(listCalls[0]?.archived).toBe(false)
    expect(listCalls[0]?.archived).not.toBe(true)
    expect(useGlobalSessionsStore.getState().activeSessions.map((item) => item.id)).toEqual([
      "active",
      "restored",
    ])
    expect(useGlobalSessionsStore.getState().archivedSessions).toEqual([])
  })

  test("Pi Archive page load passes archived: true", async () => {
    setGlobalSessionsPiKernelForTests(true)
    const loading = useGlobalSessionsStore.getState().loadArchivedSessions()
    listRequest.resolve([
      session("active"),
      session("archived", "archived", 5),
      session("restored", "restored", 0),
    ])
    await loading

    expect(listCalls).toHaveLength(1)
    expect(listCalls[0]?.archived).toBe(true)
    expect(useGlobalSessionsStore.getState().archivedSessions.map((item) => item.id)).toEqual(["archived"])
    expect(useGlobalSessionsStore.getState().activeSessions).toEqual([])
  })

  test("Pi default load keeps an already-fetched archived bucket", async () => {
    setGlobalSessionsPiKernelForTests(true)
    const archived = session("archived", "archived", 5)
    useGlobalSessionsStore.getState().applySnapshot([session("active")], [archived])

    const loading = useGlobalSessionsStore.getState().loadSessions()
    listRequest.resolve([session("active"), session("restored", "restored", 0)])
    await loading

    expect(listCalls[0]?.archived).toBe(false)
    expect(useGlobalSessionsStore.getState().activeSessions.map((item) => item.id)).toEqual([
      "active",
      "restored",
    ])
    expect(useGlobalSessionsStore.getState().archivedSessions.map((item) => item.id)).toEqual(["archived"])
  })

  test("Pi directory refresh does not pass archived: true", async () => {
    setGlobalSessionsPiKernelForTests(true)
    const archived = { ...session("archived", "archived", 5), directory: "/source" } as Session
    const active = { ...session("active"), directory: "/source" } as Session
    useGlobalSessionsStore.getState().applySnapshot([active], [archived])

    const refreshing = useGlobalSessionsStore.getState().refreshSessionsForDirectories(["/source"])
    listRequest.resolve([active])
    await refreshing

    expect(listCalls).toHaveLength(1)
    expect(listCalls[0]?.archived).toBe(false)
    expect(useGlobalSessionsStore.getState().activeSessions.map((item) => item.id)).toEqual(["active"])
    expect(useGlobalSessionsStore.getState().archivedSessions.map((item) => item.id)).toEqual(["archived"])
  })

  test("OpenCode default global load stays inclusive", async () => {
    setGlobalSessionsPiKernelForTests(false)
    const loading = useGlobalSessionsStore.getState().loadSessions()
    listRequest.resolve([session("active"), session("archived", "archived", 5), session("restored", "restored", 0)])
    await loading

    expect(listCalls).toHaveLength(1)
    expect(listCalls[0]?.archived).toBe(true)
    expect(useGlobalSessionsStore.getState().activeSessions.map((item) => item.id)).toEqual([
      "active",
      "restored",
    ])
    expect(useGlobalSessionsStore.getState().archivedSessions.map((item) => item.id)).toEqual(["archived"])
  })
})
