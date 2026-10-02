import { describe, expect, it } from 'vitest';
import { deviceOnlyNote, DEVICE_ONLY_NOTE } from '../../public/js/shared/account-copy.js';

describe('deviceOnlyNote', () => {
  it('warns a signed-out visitor that nothing leaves this browser', () => {
    expect(deviceOnlyNote({ ready: true, session: null })).toBe(DEVICE_ONLY_NOTE);
  });

  it('says nothing once they are signed in', () => {
    expect(deviceOnlyNote({ ready: true, session: { user: { id: 'u1' } } })).toBe('');
  });

  it('stays silent until the account is known, so it never flickers in and out', () => {
    expect(deviceOnlyNote({ ready: false, session: null })).toBe('');
    expect(deviceOnlyNote(null)).toBe('');
    expect(deviceOnlyNote(undefined)).toBe('');
  });
});
