import { describe, expect, it } from "vitest";
import { applyClick, applyKey, emptySelection, type KeyInput, type SelectionState } from "@/components/files/selection";

const keys = ["a", "b", "c", "d", "e", "f"];
const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, ...extra });

describe("keyboard model", () => {
  it("moves and selects a single row with the arrows, clamped to the list", () => {
    let s: SelectionState = emptySelection;
    s = applyKey(s, key("ArrowDown"), keys).state;
    expect(s.active).toBe(1);
    expect([...s.selected]).toEqual(["b"]);
    s = applyKey(s, key("ArrowUp"), keys).state;
    s = applyKey(s, key("ArrowUp"), keys).state;
    expect(s.active).toBe(0);
    s = applyKey(s, key("End"), keys).state;
    s = applyKey(s, key("ArrowDown"), keys).state;
    expect(s.active).toBe(5);
  });

  it("extends a range with Shift and shrinks it again", () => {
    let s = applyKey(emptySelection, key("ArrowDown", { shiftKey: true }), keys).state;
    s = applyKey(s, key("ArrowDown", { shiftKey: true }), keys).state;
    expect([...s.selected]).toEqual(["a", "b", "c"]);
    s = applyKey(s, key("ArrowUp", { shiftKey: true }), keys).state;
    expect([...s.selected]).toEqual(["a", "b"]);
  });

  it("toggles with Space, selects everything with Ctrl+A and clears with Escape", () => {
    let s = applyKey(emptySelection, key(" "), keys).state;
    expect([...s.selected]).toEqual(["a"]);
    s = applyKey(s, key("ArrowDown"), keys).state;
    s = applyKey(s, key(" "), keys).state;
    expect(s.selected.has("b")).toBe(false);
    s = applyKey(s, key("a", { ctrlKey: true }), keys).state;
    expect(s.selected.size).toBe(keys.length);
    s = applyKey(s, key("Escape"), keys).state;
    expect(s.selected.size).toBe(0);
  });

  it("asks to open on Enter and to delete only when something is selected", () => {
    expect(applyKey(emptySelection, key("Enter"), keys).action).toBe("open");
    expect(applyKey(emptySelection, key("Delete"), keys).action).toBeNull();
    const s = applyKey(emptySelection, key(" "), keys).state;
    expect(applyKey(s, key("Delete"), keys).action).toBe("delete");
  });

  it("ignores unrelated keys and empty lists", () => {
    expect(applyKey(emptySelection, key("x"), keys).handled).toBe(false);
    expect(applyKey(emptySelection, key("ArrowDown"), []).handled).toBe(false);
  });

  it("pages by the given size", () => {
    expect(applyKey(emptySelection, key("PageDown"), keys, 3).state.active).toBe(3);
  });
});

describe("mouse model", () => {
  it("click selects one, Ctrl toggles, Shift ranges from the anchor", () => {
    let s = applyClick(emptySelection, 1, key(""), keys);
    expect([...s.selected]).toEqual(["b"]);
    s = applyClick(s, 4, key("", { shiftKey: true }), keys);
    expect([...s.selected]).toEqual(["b", "c", "d", "e"]);
    s = applyClick(s, 2, key("", { ctrlKey: true }), keys);
    expect([...s.selected]).toEqual(["b", "d", "e"]);
    s = applyClick(s, 0, key(""), keys);
    expect([...s.selected]).toEqual(["a"]);
  });
});
