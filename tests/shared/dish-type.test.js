import { describe, expect, it } from 'vitest';
import { DISH_TYPES, dishTypeFor, isDishType } from '../../public/js/shared/dish-type.js';

const named = (name, extra = {}) => dishTypeFor({ name, ...extra });

describe('dishTypeFor', () => {
  it('recognises the dishes in this collection', () => {
    expect(named('Dal Fry with Jeera Rice')).toBe('curry');
    expect(named('Masala Dosa (South Indian)')).toBe('dosa');
    expect(named('Bhel Puri')).toBe('chaat');
    expect(named('Vada Pav')).toBe('chaat');
    expect(named('Paneer Tikka Wrap')).toBe('wrap');
    expect(named('Masala Cheese & Sweetcorn Sandwich')).toBe('sandwich');
    expect(named('Schezwan Noodles')).toBe('noodles');
    expect(named('Shrikhand')).toBe('sweet');
    expect(named('Kothimbir Vadi')).toBe('fried-snack');
    expect(named('Baingan Bharta with Bajra Roti')).toBe('curry');
    expect(named('Lemon Rice (Chitranna)')).toBe('rice');
    expect(named('Aloo Paratha with Curd (North Indian)')).toBe('flatbread');
  });

  it('takes the main dish, not the side it is served with', () => {
    expect(named('Dal Fry with Jeera Rice')).toBe('curry');
    expect(named('Bhindi Masala with Phulka')).toBe('curry');
    expect(named('Malvani Vegetable Curry with Rice Bhakri')).toBe('curry');
  });

  it('falls back to the meal type for a pudding it cannot name', () => {
    expect(named('Grandma’s Special', { meal_types: ['Dessert'] })).toBe('sweet');
    expect(named('Grandma’s Special', { mealTypes: ['Dessert'] })).toBe('sweet');
  });

  it('returns null when nothing fits, so the monogram can take over', () => {
    expect(named('Something Entirely New')).toBeNull();
    expect(dishTypeFor(null)).toBeNull();
    expect(dishTypeFor({})).toBeNull();
  });

  it('only ever names a type the art set can draw', () => {
    for (const type of DISH_TYPES) expect(isDishType(type.id)).toBe(true);
    expect(isDishType('nope')).toBe(false);
  });
});
