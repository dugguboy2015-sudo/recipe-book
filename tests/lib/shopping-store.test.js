import { describe, expect, it } from 'vitest';
import { addManualItem, clearChecks, emptyState, removeManualItem, toggleChecked } from '../../public/js/lib/shopping-store.js';

describe('shopping list state', () => {
  it('ticks and un-ticks an item without touching the rest', () => {
    const state = toggleChecked(emptyState(), 'a');
    expect(state.checked).toEqual({ a: true });
    expect(toggleChecked(state, 'a').checked).toEqual({});
    expect(toggleChecked(state, 'b').checked).toEqual({ a: true, b: true });
  });

  it('adds a hand-written item, trimmed, with who added it', () => {
    const state = addManualItem(emptyState(), '  kitchen   roll  ', 'user-1');
    expect(state.manual).toHaveLength(1);
    expect(state.manual[0]).toMatchObject({ text: 'kitchen roll', addedBy: 'user-1' });
    expect(state.manual[0].key.startsWith('manual:')).toBe(true);
  });

  it('ignores an empty item rather than adding a blank row', () => {
    const before = emptyState();
    expect(addManualItem(before, '   ')).toBe(before);
  });

  it('removing an item takes its tick with it', () => {
    let state = addManualItem(emptyState(), 'bin bags');
    const key = state.manual[0].key;
    state = toggleChecked(state, key);
    state = removeManualItem(state, key);
    expect(state.manual).toEqual([]);
    expect(state.checked[key]).toBeUndefined();
  });

  it('clearing ticks keeps the hand-written items', () => {
    let state = addManualItem(emptyState(), 'bin bags');
    state = toggleChecked(state, state.manual[0].key);
    state = toggleChecked(state, '10:count:piece');
    const cleared = clearChecks(state);
    expect(cleared.checked).toEqual({});
    expect(cleared.manual).toHaveLength(1);
  });

  it('never mutates the state it was given', () => {
    const before = emptyState();
    toggleChecked(before, 'a');
    addManualItem(before, 'x');
    expect(before).toEqual({ checked: {}, manual: [] });
  });
});
