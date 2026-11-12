import 'server-only';
import { formatDate } from '@/lib/format';
import type { CurrentUser } from '@/server/auth';
import { prisma } from '@/server/db';
import type { Column, TabularDoc } from '../reports/types';
import { getStatement } from './service';

const col = (key: string, label: string, type: Column['type'] = 'text', extra: Partial<Column> = {}): Column => ({ key, label, type, ...extra });

/** État de rapprochement : solde relevé vs solde comptable, éléments en suspens, écart final (SPEC §6.9). */
export async function buildReconciliationReport(actor: CurrentUser, statementId: string): Promise<TabularDoc> {
  const s = await getStatement(actor, statementId);
  const entity = await prisma.entity.findUniqueOrThrow({ where: { id: s.entityId } });
  const cur = s.currency;
  const r = s.reconciliation;
  const money = (key: string, label: string) => col(key, label, 'money', { currencyKey: 'currency' });
  const C = col('currency', 'Devise', 'text', { width: 0.6 });
  const lineRows = (rows: typeof s.columns.matched) =>
    rows.map((l) => ({ date: new Date(l.date).toISOString(), label: l.label, amount: l.amount, currency: cur, status: l.status === 'MATCHED' ? 'Rapproché' : l.status === 'CREATED' ? 'Créé' : l.status === 'IGNORED' ? 'Ignoré' : l.status === 'SUGGESTED' ? 'Suggéré' : 'Non rapproché', entry: l.matchedEntry?.reference ?? '' }));

  return {
    title: 'État de rapprochement bancaire',
    subtitle: `${s.accountName} — du ${formatDate(s.periodStart)} au ${formatDate(s.periodEnd)} — statut ${s.status}`,
    entityName: entity.name,
    generatedAt: new Date(), generatedBy: actor.fullName,
    signatures: ['Préparé par', 'Validé par'],
    sections: [
      {
        title: 'Synthèse', columns: [col('label', 'Libellé', 'text', { width: 3 }), C, money('amount', 'Montant')],
        rows: [
          { label: 'Solde d’ouverture du relevé', currency: cur, amount: r.statementOpening },
          { label: 'Solde de clôture du relevé', currency: cur, amount: r.statementClosing },
          { label: 'Solde comptable (grand livre) à la fin de période', currency: cur, amount: r.ledgerBalance },
          { label: 'Écritures en suspens (absentes du relevé)', currency: cur, amount: r.outstandingEntries },
          { label: 'Lignes du relevé non enregistrées', currency: cur, amount: r.unrecordedStatementLines },
          { label: 'ÉCART FINAL', currency: cur, amount: r.difference },
        ],
        note: r.balanced ? 'Rapprochement équilibré.' : 'Écart non nul : une note d’acceptation est requise pour valider.',
      },
      { title: 'Lignes rapprochées et suggestions', columns: [col('date', 'Date', 'date', { width: 0.9 }), col('label', 'Libellé du relevé', 'text', { width: 2.4 }), money('amount', 'Montant'), C, col('status', 'État', 'text', { width: 1.1 }), col('entry', 'Écriture', 'text', { width: 1.5 })], rows: lineRows(s.columns.matched) },
      { title: 'Lignes du relevé non enregistrées', columns: [col('date', 'Date', 'date', { width: 0.9 }), col('label', 'Libellé', 'text', { width: 2.4 }), money('amount', 'Montant'), C, col('status', 'État', 'text', { width: 1.1 })], rows: lineRows(s.columns.unrecorded) },
      { title: 'Écritures absentes du relevé', columns: [col('date', 'Date', 'date', { width: 0.9 }), col('reference', 'Référence', 'text', { width: 1.5 }), col('description', 'Libellé', 'text', { width: 2.4 }), money('amount', 'Montant'), C], rows: s.columns.missingFromStatement.map((e) => ({ date: new Date(e.date).toISOString(), reference: e.reference, description: e.description, amount: e.amount, currency: cur })) },
      { title: 'Écarts de montant', columns: [col('date', 'Date', 'date', { width: 0.9 }), col('label', 'Libellé du relevé', 'text', { width: 2.4 }), money('amount', 'Montant relevé'), C, col('entry', 'Écriture concernée', 'text', { width: 1.5 })], rows: s.columns.amountDifferences.map((l) => ({ date: new Date(l.date).toISOString(), label: l.label, amount: l.amount, currency: cur, entry: l.amountDiffEntry?.reference ?? '' })) },
    ],
  };
}
