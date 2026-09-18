import { describe, expect, it } from 'vitest';
import {
  INVITE_CODE_PATTERN, generateInviteCode, isFoundingEmail, validateCreateHousehold, validateJoin,
} from '../../functions/_lib/household.js';

const DIETS = ['vegetarian_egg_free', 'vegetarian', 'omnivore'];

describe('generateInviteCode', () => {
  it('produces 32 URL-safe characters', () => {
    for (let i = 0; i < 50; i += 1) expect(generateInviteCode()).toMatch(INVITE_CODE_PATTERN);
  });

  it('does not repeat', () => {
    const codes = new Set(Array.from({ length: 500 }, generateInviteCode));
    expect(codes.size).toBe(500);
  });
});

describe('isFoundingEmail', () => {
  it('matches case- and whitespace-insensitively', () => {
    expect(isFoundingEmail(' Owner@Example.com ', 'owner@example.com')).toBe(true);
  });

  it('never matches when no founding email is configured', () => {
    expect(isFoundingEmail('owner@example.com', '')).toBe(false);
    expect(isFoundingEmail('owner@example.com', undefined)).toBe(false);
    expect(isFoundingEmail('', '')).toBe(false);
  });

  it('does not match a different address', () => {
    expect(isFoundingEmail('someone@example.com', 'owner@example.com')).toBe(false);
  });
});

describe('validateCreateHousehold', () => {
  it('accepts and tidies a valid household', () => {
    const { ok, value } = validateCreateHousehold({ name: '  The   Sharma family ', displayName: ' Asha ', diet: 'vegetarian' }, DIETS);
    expect(ok).toBe(true);
    expect(value).toEqual({ name: 'The Sharma family', displayName: 'Asha', diet: 'vegetarian' });
  });

  it('requires a name, your name and a known diet', () => {
    const { ok, errors } = validateCreateHousehold({ name: ' ', displayName: '', diet: 'carnivore' }, DIETS);
    expect(ok).toBe(false);
    expect(Object.keys(errors).sort()).toEqual(['diet', 'displayName', 'name']);
  });

  it('does not require a diet for the founding household, whose rules come from config', () => {
    const { ok } = validateCreateHousehold({ name: 'Family', displayName: 'Me' }, DIETS, { requireDiet: false });
    expect(ok).toBe(true);
  });

  it('caps the lengths', () => {
    const { errors } = validateCreateHousehold({ name: 'x'.repeat(81), displayName: 'y'.repeat(61), diet: 'omnivore' }, DIETS);
    expect(errors.name).toBeTruthy();
    expect(errors.displayName).toBeTruthy();
  });
});

describe('validateJoin', () => {
  it('accepts a well-formed code and name', () => {
    const code = generateInviteCode();
    expect(validateJoin({ code: ` ${code} `, displayName: 'Ravi' })).toEqual({ ok: true, value: { code, displayName: 'Ravi' }, errors: {} });
  });

  it('rejects a truncated or pasted-with-junk code', () => {
    expect(validateJoin({ code: 'abc', displayName: 'Ravi' }).errors.code).toBeTruthy();
    expect(validateJoin({ code: `${generateInviteCode()}!`, displayName: 'Ravi' }).errors.code).toBeTruthy();
  });
});
