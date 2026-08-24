import { describe, expect, test } from "bun:test"

import { Button } from "./button"

describe("Button", () => {
  test("defaults native buttons to type button", () => {
    const element = Button({ children: "Cancel" })

    expect(element.props.type).toBe("button")
  })

  test("preserves explicit native button types", () => {
    const element = Button({ children: "Save", type: "submit" })

    expect(element.props.type).toBe("submit")
  })

  test("does not default asChild buttons", () => {
    const element = Button({ asChild: true, children: "Link" })

    expect(element.props.type).toBe(undefined)
  })

  test("keeps locale sentence case when callers pass normal-case", () => {
    const element = Button({ children: "Cancel", className: "normal-case" })

    expect(element.props.className).toContain("normal-case")
    expect(element.props.className.split(/\s+/)).not.toContain("lowercase")
  })
})
