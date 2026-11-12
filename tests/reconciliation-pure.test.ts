import { describe, expect, it } from 'vitest';
import { findDuplicates, matchLines, toCents, type MatchableEntry, type MatchableLine } from '../src/server/modules/reconciliation/matcher';
import { applyMapping, parseAmount, parseCsv } from '../src/server/modules/reconciliation/parser';

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const line = (id: string, amount: string, date: string, label = 'VIREMENT', reference: string | null = null): MatchableLine => ({
  id, cents: toCents(amount), date: d(date), label, reference,
});
const entry = (id: string, amount: string, date: string, reference = `REF-${id}`): MatchableEntry => ({ id, cents: toCents(amount), date: d(date), reference });
const byId = (out: ReturnType<typeof matchLines>, id: string) => out.find((o) => o.lineId === id)!;

describe('algorithme de rapprochement — jeu de test complet', () => {
  const lines = [
    line('exact', '100.00', '2026-11-10', 'VIR SEC-VIR-2026-00001 loyer'),
    line('d2', '200.00', '2026-11-12'),
    line('d6', '300.00', '2026-11-16'),
    line('d9', '400.00', '2026-11-19'),
    line('ambig', '150.00', '2026-11-10'),
    line('fee', '-5.00', '2026-11-11', 'FRAIS TENUE DE COMPTE'),
    line('diff', '999.00', '2026-11-11', 'REGLEMENT SEC-DEP-2026-00007'),
  ];
  const entries = [
    entry('e-exact', '100.00', '2026-11-10', 'SEC-VIR-2026-00001'),
    entry('e-d2', '200.00', '2026-11-10'),
    entry('e-d6', '300.00', '2026-11-10'),
    entry('e-d9', '400.00', '2026-11-10'),
    entry('e-a1', '150.00', '2026-11-09'),
    entry('e-a2', '150.00', '2026-11-11'),
    entry('e-diff', '1000.00', '2026-11-11', 'SEC-DEP-2026-00007'),
  ];
  const out = matchLines(lines, entries);

  it('même montant + même référence ⇒ 100, pré-coché car candidat unique', () => {
    expect(byId(out, 'exact')).toMatchObject({ status: 'SUGGESTED', confidence: 100, candidateIds: ['e-exact'], preselectedId: 'e-exact' });
  });
  it('même montant + date à ±3 jours ⇒ 80, jamais pré-coché', () => {
    expect(byId(out, 'd2')).toMatchObject({ status: 'SUGGESTED', confidence: 80, preselectedId: null });
  });
  it('même montant + date à ±7 jours ⇒ 50 ; au-delà ⇒ non rapproché', () => {
    expect(byId(out, 'd6')).toMatchObject({ status: 'SUGGESTED', confidence: 50, preselectedId: null });
    expect(byId(out, 'd9')).toMatchObject({ status: 'UNMATCHED', confidence: null });
  });
  it('plusieurs candidats ⇒ SUGGESTED avec la liste, aucune confirmation automatique', () => {
    const o = byId(out, 'ambig');
    expect(o.status).toBe('SUGGESTED');
    expect(o.candidateIds).toHaveLength(2);
    expect(o.candidateIds).toEqual(expect.arrayContaining(['e-a1', 'e-a2']));
    expect(o.preselectedId).toBeNull();
  });
  it('frais non enregistré ⇒ non rapproché, sans candidat (bouton « créer l’opération »)', () => {
    expect(byId(out, 'fee')).toMatchObject({ status: 'UNMATCHED', candidateIds: [], amountDiffEntryId: null });
  });
  it('même référence mais montant différent ⇒ écart de montant signalé, jamais rapproché', () => {
    expect(byId(out, 'diff')).toMatchObject({ status: 'UNMATCHED', amountDiffEntryId: 'e-diff' });
  });
  it('aucune ligne n’est jamais en statut « confirmé » par l’algorithme', () => {
    expect(out.every((o) => o.status === 'SUGGESTED' || o.status === 'UNMATCHED')).toBe(true);
  });
});

describe('cas limites du matcher', () => {
  it('deux lignes identiques pour une seule écriture : aucune n’est pré-cochée', () => {
    const out = matchLines(
      [line('a', '50.00', '2026-11-10', 'SEC-VIR-1'), line('b', '50.00', '2026-11-10', 'SEC-VIR-1')],
      [entry('e', '50.00', '2026-11-10', 'SEC-VIR-1')],
    );
    expect(out.every((o) => o.status === 'SUGGESTED' && o.preselectedId === null)).toBe(true);
  });
  it('les signes comptent : un débit ne se rapproche pas d’un crédit de même valeur', () => {
    const out = matchLines([line('a', '-100.00', '2026-11-10')], [entry('e', '100.00', '2026-11-10')]);
    expect(out[0]!.status).toBe('UNMATCHED');
  });
  it('comparaison exacte en centimes, sans erreur flottante (0,10 + 0,20 ≠ 0,30000000000000004)', () => {
    expect(toCents('0.30')).toBe(30n);
    expect(toCents('-1250.5')).toBe(-125050n);
    const out = matchLines([line('a', '0.30', '2026-11-10')], [entry('e', '0.30', '2026-11-10')]);
    expect(out[0]!.status).toBe('SUGGESTED');
  });
  it('doublons du relevé : même montant, même jour, libellé similaire', () => {
    const dup = findDuplicates([
      line('1', '-25.00', '2026-11-10', 'PAIEMENT CARTE STATION TOTAL'),
      line('2', '-25.00', '2026-11-10', 'PAIEMENT CARTE STATION TOTAL'),
      line('3', '-25.00', '2026-11-10', 'LOYER'),
      line('4', '-25.00', '2026-11-11', 'PAIEMENT CARTE STATION TOTAL'),
    ]);
    expect([...dup.entries()]).toEqual([['2', '1']]);
  });
});

describe('lecture des relevés', () => {
  it('montants : formats français et anglais, parenthèses, sans passer par number', () => {
    const cases: [string, string | null][] = [
      ['1 250,50', '1250.5'], ['1.250,50', '1250.5'], ['1,250.50', '1250.5'], ['-1250.50', '-1250.5'],
      ['(100,00)', '-100'], ['100 DB', '-100'], ['100 CR', '100'], ['2 500 000', '2500000'], ['12', '12'], ['abc', null], ['', null],
    ];
    for (const [raw, expected] of cases) expect(parseAmount(raw)?.toString() ?? null).toBe(expected);
  });

  it('CSV : séparateur détecté, guillemets, BOM', () => {
    expect(parseCsv('﻿date;libellé;montant\n10/11/2026;"VIR; SEC";1 000,00')).toEqual([
      ['date', 'libellé', 'montant'], ['10/11/2026', 'VIR; SEC', '1 000,00'],
    ]);
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('mapping débit/crédit ou montant signé ; lignes invalides listées avec leur numéro', () => {
    const rows = [
      ['Date', 'Libellé', 'Réf', 'Débit', 'Crédit'],
      ['10/11/2026', 'FRAIS', '', '5,00', ''],
      ['11/11/2026', 'VIREMENT RECU', 'R1', '', '2 000,00'],
      ['pas-une-date', 'X', '', '1', ''],
      ['12/11/2026', '', '', '1', ''],
      ['13/11/2026', 'VIDE', '', '', ''],
    ];
    const { lines, errors } = applyMapping(rows, { hasHeader: true, date: 0, label: 1, reference: 2, debit: 3, credit: 4 });
    expect(lines.map((l) => [l.label, l.amount.toString(), l.reference])).toEqual([['FRAIS', '-5', null], ['VIREMENT RECU', '2000', 'R1']]);
    expect(errors.map((e) => e.row)).toEqual([4, 5, 6]);

    const signed = applyMapping([['10/11/2026', 'X', '-12,5']], { hasHeader: false, date: 0, label: 1, amount: 2 });
    expect(signed.lines[0]!.amount.toString()).toBe('-12.5');
  });
});
