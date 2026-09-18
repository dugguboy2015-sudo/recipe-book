import { describe, expect, it } from 'vitest';
import { inviteCodeFrom, isInviteCode } from '../../public/js/lib/pending-invite.js';

const CODE = 'abcDEF0123456789_-abcDEF01234567';

describe('isInviteCode', () => {
  it('accepts a 32-character base64url code', () => {
    expect(isInviteCode(CODE)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isInviteCode(CODE.slice(1))).toBe(false);
    expect(isInviteCode(`${CODE}x`)).toBe(false);
    expect(isInviteCode(CODE.replace('_', '/'))).toBe(false);
    expect(isInviteCode(null)).toBe(false);
  });
});

describe('inviteCodeFrom', () => {
  it('pulls the code out of a pasted invite link', () => {
    expect(inviteCodeFrom(`  https://recipe-book-9eo.pages.dev/?invite=${CODE}  `)).toBe(CODE);
  });

  it('returns a bare code unchanged (trimmed)', () => {
    expect(inviteCodeFrom(` ${CODE}\n`)).toBe(CODE);
  });

  it('returns a link without an invite as-is, for isInviteCode to reject', () => {
    const text = 'https://recipe-book-9eo.pages.dev/recipes.html';
    expect(inviteCodeFrom(text)).toBe(text);
    expect(isInviteCode(inviteCodeFrom(text))).toBe(false);
  });
});
