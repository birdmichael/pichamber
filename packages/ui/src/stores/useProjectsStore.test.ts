import { describe, expect, test } from "bun:test"
import type { ProjectEntry } from "@/lib/api/types"
import type { DesktopSettings } from "@/lib/desktop"
import { useProjectsStore } from "./useProjectsStore"

describe("useProjectsStore settings synchronization", () => {
  test("treats a successful empty project snapshot as authoritative", () => {
    const project = { id: "project-a", path: "/repo", label: "Repo" } as ProjectEntry
    useProjectsStore.setState({
      projects: [project],
      activeProjectId: project.id,
      manualProjectOrder: [project.id],
    })

    useProjectsStore.getState().synchronizeFromSettings({ projects: [] } as DesktopSettings)

    expect(useProjectsStore.getState().projects).toEqual([])
    expect(useProjectsStore.getState().activeProjectId).toBe(null)
    expect(useProjectsStore.getState().manualProjectOrder).toEqual([])
  })

  test("keeps a project thinking pin next to its default model", () => {
    useProjectsStore.getState().synchronizeFromSettings({
      projects: [
        {
          id: "ignored",
          path: "/repo/thinking-pin",
          label: "Repo",
          defaultModel: "xai/grok-4.6",
          defaultVariant: "high",
        },
      ],
    } as DesktopSettings)

    const project = useProjectsStore.getState().projects.find((entry) => entry.path === "/repo/thinking-pin")
    expect(project?.defaultModel).toBe("xai/grok-4.6")
    expect(project?.defaultVariant).toBe("high")
  })

  test("strips a thinking pin that has no project model", () => {
    useProjectsStore.getState().synchronizeFromSettings({
      projects: [
        {
          id: "ignored",
          path: "/repo/variant-only",
          label: "Repo",
          defaultVariant: "high",
        },
      ],
    } as DesktopSettings)

    const project = useProjectsStore.getState().projects.find((entry) => entry.path === "/repo/variant-only")
    expect(project?.defaultModel).toBeUndefined()
    expect(project?.defaultVariant).toBeUndefined()
  })

  test("updateProjectMeta clears the thinking pin when the model is removed", () => {
    useProjectsStore.getState().synchronizeFromSettings({
      projects: [
        {
          id: "ignored",
          path: "/repo/clear-pin",
          label: "Repo",
          defaultModel: "xai/grok-4.6",
          defaultVariant: "high",
        },
      ],
    } as DesktopSettings)

    const project = useProjectsStore.getState().projects.find((entry) => entry.path === "/repo/clear-pin")
    expect(project).toBeDefined()

    useProjectsStore.getState().updateProjectMeta(project!.id, {
      defaultModel: null,
      defaultVariant: "high",
    })

    const updated = useProjectsStore.getState().projects.find((entry) => entry.path === "/repo/clear-pin")
    expect(updated?.defaultModel).toBeUndefined()
    expect(updated?.defaultVariant).toBeUndefined()
  })
})
