/**
 * Payee rules turn messy bank descriptions ("SQ *BLUE BOTTLE 0423") into clean
 * payees ("Blue Bottle") and pick a category. Shared by the app and the server.
 */

export interface PayeeRule {
  id: string;
  /** Text to look for in the bank's description (case doesn't matter). */
  match: string;
  matchType: 'contains' | 'exact';
  /** New payee name; empty keeps the bank's name. */
  rename?: string;
  /** Category to use; null/undefined leaves it to the remembered category. */
  categoryId?: string | null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function ruleMatches(rule: PayeeRule, text: string): boolean {
  const m = norm(rule.match);
  if (!m) return false;
  return rule.matchType === 'exact' ? norm(text) === m : norm(text).includes(m);
}

/** The rule for a description: exact rules first, then the most specific (longest) match. */
export function findRule(rules: PayeeRule[], text: string): PayeeRule | undefined {
  return rules
    .filter((r) => ruleMatches(r, text))
    .sort((a, b) => (a.matchType === 'exact' ? 0 : 1) - (b.matchType === 'exact' ? 0 : 1) || norm(b.match).length - norm(a.match).length)[0];
}

/** Payee and category for a raw bank description. */
export function applyRules(
  rules: PayeeRule[],
  raw: string,
  payeeCategory: Record<string, string>,
): { payee: string; categoryId: string | null } {
  const rule = findRule(rules, raw);
  const payee = rule?.rename?.trim() || raw.trim();
  const categoryId = rule?.categoryId ?? payeeCategory[payee] ?? payeeCategory[raw.trim()] ?? null;
  return { payee, categoryId };
}

/**
 * A good default "contains" text for a rule: the description without trailing
 * store numbers, dates or reference codes ("SQ *BLUE BOTTLE 0423" -> "SQ *BLUE BOTTLE").
 */
export function suggestMatch(raw: string): string {
  const words = raw.trim().split(/\s+/);
  while (words.length > 1 && /\d/.test(words[words.length - 1])) words.pop();
  return words.join(' ').replace(/[#*]\s*$/, '').trim();
}
