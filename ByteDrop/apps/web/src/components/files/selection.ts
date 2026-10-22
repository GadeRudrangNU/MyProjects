export interface SelectionState {
  active: number;
  anchor: number;
  selected: ReadonlySet<string>;
}

export const emptySelection: SelectionState = { active: 0, anchor: 0, selected: new Set() };

export type KeyAction = "open" | "delete" | null;

export interface KeyInput {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

const range = (keys: string[], a: number, b: number) => new Set(keys.slice(Math.min(a, b), Math.max(a, b) + 1));

/** Pure keyboard model for the file list: arrows move, Shift extends, Space toggles, Ctrl/Cmd+A selects all loaded rows. */
export function applyKey(
  state: SelectionState,
  e: KeyInput,
  keys: string[],
  pageSize = 10,
): { state: SelectionState; action: KeyAction; handled: boolean } {
  const last = keys.length - 1;
  if (last < 0) return { state, action: null, handled: false };
  const move = (to: number) => {
    const active = Math.max(0, Math.min(last, to));
    if (e.shiftKey) return { active, anchor: state.anchor, selected: range(keys, state.anchor, active) };
    return { active, anchor: active, selected: new Set([keys[active]!]) };
  };

  switch (e.key) {
    case "ArrowDown":
      return { state: move(state.active + 1), action: null, handled: true };
    case "ArrowUp":
      return { state: move(state.active - 1), action: null, handled: true };
    case "PageDown":
      return { state: move(state.active + pageSize), action: null, handled: true };
    case "PageUp":
      return { state: move(state.active - pageSize), action: null, handled: true };
    case "Home":
      return { state: move(0), action: null, handled: true };
    case "End":
      return { state: move(last), action: null, handled: true };
    case " ": {
      const next = new Set(state.selected);
      const k = keys[state.active]!;
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return { state: { ...state, anchor: state.active, selected: next }, action: null, handled: true };
    }
    case "a":
    case "A":
      if (e.ctrlKey || e.metaKey) return { state: { ...state, selected: new Set(keys) }, action: null, handled: true };
      return { state, action: null, handled: false };
    case "Escape":
      return { state: { ...state, selected: new Set() }, action: null, handled: state.selected.size > 0 };
    case "Enter":
      return { state, action: "open", handled: true };
    case "Delete":
    case "Backspace":
      return { state, action: state.selected.size > 0 ? "delete" : null, handled: true };
    default:
      return { state, action: null, handled: false };
  }
}

/** Mouse selection: plain click selects one, Ctrl/Cmd toggles, Shift selects a range from the anchor. */
export function applyClick(state: SelectionState, index: number, e: Pick<KeyInput, "shiftKey" | "ctrlKey" | "metaKey">, keys: string[]): SelectionState {
  const k = keys[index];
  if (k === undefined) return state;
  if (e.shiftKey) return { active: index, anchor: state.anchor, selected: range(keys, state.anchor, index) };
  if (e.ctrlKey || e.metaKey) {
    const next = new Set(state.selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    return { active: index, anchor: index, selected: next };
  }
  return { active: index, anchor: index, selected: new Set([k]) };
}
