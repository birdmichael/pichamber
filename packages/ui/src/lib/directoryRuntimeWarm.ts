import { runtimeFetch } from "./runtime-fetch"

const warming = new Set<string>()

export const warmDirectoryRuntime = (directory: string | null | undefined): void => {
  const cwd = typeof directory === "string" ? directory.trim() : ""
  if (!cwd || warming.has(cwd)) return
  warming.add(cwd)
  void runtimeFetch("/api/pi/directory-runtime/warm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ directory: cwd }),
  }).catch(() => undefined)
}
