import { describe, expect, it } from 'vitest';
import { isDifferentAccount, maskEmail } from '../../public/js/shared/sign-in-memory.js';

describe('isDifferentAccount', () => {
  // The case this exists for: production has two accounts and two households both called
  // "The Babre's", because a second address signed in and was offered household setup in silence.
  it('spots a different address than the one this browser knows', () => {
    expect(isDifferentAccount('second@example.com', 'first@example.com')).toBe(true);
  });

  it('says nothing when it is the same person coming back', () => {
    expect(isDifferentAccount('priya@example.com', 'priya@example.com')).toBe(false);
  });

  it('treats case and stray spaces as the same address, because people paste', () => {
    expect(isDifferentAccount('  Priya@Example.com ', 'priya@example.com')).toBe(false);
  });

  it('stays quiet when there is nothing to compare', () => {
    expect(isDifferentAccount('priya@example.com', '')).toBe(false);
    expect(isDifferentAccount('', 'priya@example.com')).toBe(false);
    expect(isDifferentAccount(null, undefined)).toBe(false);
  });
});

describe('maskEmail', () => {
  it('shows enough to recognise an address without printing it in full', () => {
    expect(maskEmail('priya.sharma@gmail.com')).toBe('pr…a@gmail.com');
  });

  it('still masks a very short local part', () => {
    expect(maskEmail('ab@x.com')).toBe('a…@x.com');
  });

  it('leaves anything that is not an address alone', () => {
    expect(maskEmail('not-an-email')).toBe('not-an-email');
    expect(maskEmail('')).toBe('');
  });

  it('keeps the domain intact, which is what people actually check', () => {
    expect(maskEmail('someone@a-very-long-domain.co.uk')).toContain('@a-very-long-domain.co.uk');
  });
});
