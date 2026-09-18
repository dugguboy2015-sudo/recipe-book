import { describe, expect, it } from 'vitest';
import template from '../../config/household.json';
import { buildMessages } from '../../functions/_lib/ai/prompt.js';
import { buildNewHouseholdSettings } from '../../public/js/shared/household-settings.js';

const system = (household) => buildMessages({ prompt: 'dal', effectiveGoal: 'balanced', household })[0].content;

describe('buildMessages — the family comes from the household (M1d)', () => {
  it("keeps the founding household's strict vegetarian, egg-free rules and preferences", () => {
    const text = system(template);
    expect(text).toContain('Strictly vegetarian and egg-free');
    expect(text).toContain('is_vegetarian and is_egg_free must both be true');
    expect(text).toContain('South Indian');
    expect(text).toContain('Packed lunches for son at secondary school');
  });

  it('describes a household that eats everything without vegetarian rules', () => {
    const text = system(buildNewHouseholdSettings(template, 'omnivore'));
    expect(text).toContain('They eat meat, fish and eggs');
    expect(text).not.toContain('Strictly vegetarian');
    expect(text).not.toContain('must both be true');
    expect(text).not.toContain('Packed lunches for');
  });

  it('defaults to the founding household when none is given', () => {
    expect(system(undefined)).toContain('Strictly vegetarian and egg-free');
  });
});
