import { describe, expect, it } from 'vitest';
import { planImport } from './importPlan';
import { applyRules, findRule, suggestMatch, type PayeeRule } from './payeeRules';

const rules: PayeeRule[] = [
  { id: 'r1', match: 'blue bottle', matchType: 'contains', rename: 'Blue Bottle', categoryId: 'coffee' },
  { id: 'r2', match: 'amzn', matchType: 'contains', rename: 'Amazon' },
  { id: 'r3', match: 'AMZN Mktp US Prime', matchType: 'exact', rename: 'Amazon Prime', categoryId: 'subs' },
];

describe('payee rules', () => {
  it('matches ignoring case and extra spaces; exact and longer rules win', () => {
    expect(findRule(rules, 'SQ *BLUE  BOTTLE 0423')?.id).toBe('r1');
    expect(findRule(rules, 'amzn mktp us prime')?.id).toBe('r3');
    expect(findRule(rules, 'AMZN Mktp US*2K4')?.id).toBe('r2');
    expect(findRule(rules, 'Corner Store')).toBeUndefined();
  });

  it('renames and categorizes, falling back to remembered categories', () => {
    expect(applyRules(rules, 'SQ *BLUE BOTTLE 0423', {})).toEqual({ payee: 'Blue Bottle', categoryId: 'coffee' });
    expect(applyRules(rules, 'AMZN Mktp US*2K4', { Amazon: 'shopping' })).toEqual({ payee: 'Amazon', categoryId: 'shopping' });
    expect(applyRules(rules, 'Corner Store', {})).toEqual({ payee: 'Corner Store', categoryId: null });
  });

  it('suggests match text without store numbers and codes', () => {
    expect(suggestMatch('SQ *BLUE BOTTLE 0423')).toBe('SQ *BLUE BOTTLE');
    expect(suggestMatch('SHELL OIL 57444 12/03')).toBe('SHELL OIL');
    expect(suggestMatch('Netflix')).toBe('Netflix');
  });
});

describe('importing with rules', () => {
  const links = { b: { appAccountId: 'chk', importFrom: '2026-01-01' } };
  it('new bank transactions are renamed, categorized and wait for review', () => {
    const r = planImport({
      added: [{ transaction_id: 't1', account_id: 'b', amount: 5.5, date: '2026-10-05', name: 'SQ *BLUE BOTTLE 0423', merchant_name: null, pending: false }],
      modified: [],
      removed: [],
      links,
      existing: [],
      payeeCategory: {},
      rules,
    });
    expect(r.upserts[0]).toMatchObject({ payee: 'Blue Bottle', categoryId: 'coffee', bankPayee: 'SQ *BLUE BOTTLE 0423', approved: false });
  });

  it('a rule can match the full description when the merchant name differs', () => {
    const r = planImport({
      added: [{ transaction_id: 't1', account_id: 'b', amount: 12, date: '2026-10-05', name: 'AMZN Mktp US*2K4', merchant_name: 'Amazon Marketplace', pending: false }],
      modified: [],
      removed: [],
      links,
      existing: [],
      payeeCategory: {},
      rules,
    });
    expect(r.upserts[0]).toMatchObject({ payee: 'Amazon', bankPayee: 'AMZN Mktp US*2K4' });
  });
});
