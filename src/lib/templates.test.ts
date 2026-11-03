import { describe, expect, it } from 'vitest';
import { addCategory, addTemplateGroups, starterData } from './ops';
import { TEMPLATES } from './templates';

describe('category templates', () => {
  it('every template builds a budget', () => {
    for (const t of TEMPLATES) {
      const d = starterData(t.id);
      expect(d.groups.map((g) => g.name)).toEqual(Object.keys(t.groups));
      expect(d.categories).toHaveLength(Object.values(t.groups).flat().length);
    }
  });

  it('adds only missing categories, merging into same-named groups', () => {
    let d = starterData('standard');
    const bills = d.groups.find((g) => g.name === 'Bills')!.id;
    d = addCategory(d, bills, 'Gym');
    const before = d.categories.length;
    // Adding the same template again changes nothing.
    expect(addTemplateGroups(d, 'standard').categories).toHaveLength(before);
    // Family's "Goals" group is new; only that group is added.
    const next = addTemplateGroups(d, 'family', ['Goals']);
    expect(next.groups.map((g) => g.name)).toEqual(['Bills', 'Needs', 'Wants', 'Savings', 'Goals']);
    expect(next.categories.length - before).toBe(3);
  });
});
