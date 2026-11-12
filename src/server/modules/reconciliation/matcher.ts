import 'server-only';

/**
 * Algorithme de suggestion de rapprochement (SPEC §6.9). Fonction PURE (aucun accès base) :
 *  1. même montant exact + même référence ........................ confiance 100
 *  2. même montant + date à ±3 jours ............................. confiance 80
 *  3. même montant + date à ±7 jours ............................. confiance 50
 * Plusieurs candidats ⇒ SUGGESTED avec la liste, jamais confirmé automatiquement.
 * Seul le score 100 avec UN SEUL candidat peut être pré-coché ; toute correspondance est confirmée par un humain.
 */
export interface MatchableLine {
  id: string;
  /** Centimes (entier) pour comparer sans flottant : montants jamais passés en number décimal. */
  cents: bigint;
  date: Date;
  label: string;
  reference: string | null;
}

export interface MatchableEntry {
  id: string;
  cents: bigint;
  date: Date;
  /** Référence de la transaction (ex. SEC-VIR-2026-00012), cherchée dans libellé/référence du relevé. */
  reference: string;
}

export type MatchOutcome =
  | { lineId: string; status: 'UNMATCHED'; confidence: null; candidateIds: []; preselectedId: null; amountDiffEntryId: string | null }
  | { lineId: string; status: 'SUGGESTED'; confidence: 100 | 80 | 50; candidateIds: string[]; preselectedId: string | null; amountDiffEntryId: null };

const DAY = 86_400_000;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "1250.50" → 125050n. Exact, sans number. */
export function toCents(amount: string): bigint {
  const neg = amount.startsWith('-');
  const [i = '0', f = ''] = amount.replace('-', '').split('.');
  const v = BigInt(i) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2));
  return neg ? -v : v;
}

function referenceMatches(line: MatchableLine, entry: MatchableEntry): boolean {
  const ref = norm(entry.reference);
  if (!ref) return false;
  return norm(line.reference ?? '').includes(ref) || norm(line.label).includes(ref);
}

function score(line: MatchableLine, entry: MatchableEntry): 100 | 80 | 50 | 0 {
  if (line.cents !== entry.cents) return 0;
  if (referenceMatches(line, entry)) return 100;
  const days = Math.abs(line.date.getTime() - entry.date.getTime()) / DAY;
  if (days <= 3) return 80;
  if (days <= 7) return 50;
  return 0;
}

export function matchLines(lines: MatchableLine[], entries: MatchableEntry[]): MatchOutcome[] {
  // Scores de toutes les paires (ligne, écriture) non nulles.
  const perLine = new Map<string, { entry: MatchableEntry; score: 100 | 80 | 50 }[]>();
  for (const l of lines) {
    const cands = entries
      .map((e) => ({ entry: e, score: score(l, e) }))
      .filter((c): c is { entry: MatchableEntry; score: 100 | 80 | 50 } => c.score > 0)
      .sort((a, b) => b.score - a.score || Math.abs(a.entry.date.getTime() - l.date.getTime()) - Math.abs(b.entry.date.getTime() - l.date.getTime()));
    perLine.set(l.id, cands);
  }

  // Une écriture ne peut être pré-cochée que pour UNE ligne : si deux lignes la convoitent au score maximal,
  // aucune n'est pré-cochée (ambiguïté ⇒ décision humaine).
  const claims = new Map<string, number>();
  for (const cands of perLine.values()) {
    const best = cands[0];
    if (best) claims.set(best.entry.id, (claims.get(best.entry.id) ?? 0) + 1);
  }

  return lines.map((l): MatchOutcome => {
    const cands = perLine.get(l.id) ?? [];
    if (cands.length === 0) {
      // Même référence mais montant différent ⇒ « écart de montant » (jamais rapproché automatiquement).
      const diff = entries.find((e) => e.cents !== l.cents && referenceMatches(l, e));
      return { lineId: l.id, status: 'UNMATCHED', confidence: null, candidateIds: [], preselectedId: null, amountDiffEntryId: diff?.id ?? null };
    }
    const top = cands[0]!;
    // Pré-cochage : score 100 ET candidat strictement unique ET écriture non convoitée par une autre ligne.
    const preselect = top.score === 100 && cands.length === 1 && (claims.get(top.entry.id) ?? 0) === 1;
    return {
      lineId: l.id, status: 'SUGGESTED', confidence: top.score,
      candidateIds: cands.map((c) => c.entry.id), preselectedId: preselect ? top.entry.id : null, amountDiffEntryId: null,
    };
  });
}

/** Doublons dans le relevé : même montant + même jour + libellé similaire (ou identique). Renvoie lineId → id de la 1re occurrence. */
export function findDuplicates(lines: MatchableLine[]): Map<string, string> {
  const dup = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = lines[j]!;
      const b = lines[i]!;
      if (dup.has(b.id) || a.cents !== b.cents) continue;
      if (a.date.toISOString().slice(0, 10) !== b.date.toISOString().slice(0, 10)) continue;
      if (similarity(norm(a.label), norm(b.label)) >= 0.8) { dup.set(b.id, a.id); break; }
    }
  }
  return dup;
}

/** Similarité de Dice sur bigrammes (0..1). */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
  const ga = grams(a); const gb = grams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}
