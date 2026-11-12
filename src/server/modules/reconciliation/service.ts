import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { localDay, localDayEnd } from '@/lib/dates';
import type { ColumnMappingInput } from '@/lib/schemas/reconciliation';
import { writeAudit } from '@/server/audit';
import type { CurrentUser, RequestMeta } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { getAccountBalance } from '@/server/ledger';
import { D, sum, toMoneyString, type Money } from '@/server/money';
import { accessibleEntityIds, assertCan } from '@/server/permissions';
import { putObject } from '@/server/storage';
import { requireStepUp } from '@/server/totp';
import { loadAccountFor } from '../shared';
import { recordIncome } from '../incomes/service';
import { recordBankFeeTx } from '../transfers/service';
import { findDuplicates, matchLines, toCents, type MatchableEntry, type MatchableLine } from './matcher';
import { applyMapping, readStatementRows } from './parser';

type Tx = Prisma.TransactionClient;
const MAX_STATEMENT_BYTES = 10 * 1024 * 1024;
const WINDOW_DAYS = 7;

const fmt = (m: Money) => toMoneyString(m);

async function loadStatement(actor: CurrentUser, id: string, tx: Tx | typeof prisma = prisma) {
  const st = await tx.bankStatement.findUnique({ where: { id } });
  if (!st || !accessibleEntityIds(actor).includes(st.entityId)) throw new AppError('NOT_FOUND', 404, 'Relevé introuvable');
  assertCan(actor, 'reconciliation.manage', st.entityId);
  return st;
}

/** Étape 1 de l'import : colonnes détectées, aperçu, et mapping mémorisé pour ce compte. */
export async function previewStatement(actor: CurrentUser, accountId: string, fileName: string, bytes: Buffer) {
  const account = await loadAccountFor(prisma, actor, accountId, 'reconciliation.manage');
  if (account.type !== 'BANK') throw new AppError('VALIDATION_ERROR', 400, 'Le rapprochement concerne un compte bancaire');
  if (bytes.length > MAX_STATEMENT_BYTES) throw new AppError('FILE_TOO_LARGE', 413, 'Fichier trop volumineux (10 Mo maximum)');
  const rows = await readStatementRows(fileName, bytes).catch(() => {
    throw new AppError('UNSUPPORTED_FILE_TYPE', 415, 'Formats acceptés : CSV ou Excel (.xlsx)');
  });
  if (rows.length === 0) throw new AppError('VALIDATION_ERROR', 400, 'Fichier vide');
  const saved = await prisma.bankColumnMapping.findUnique({ where: { accountId } });
  return { rowCount: rows.length, firstRow: rows[0], sample: rows.slice(0, 6), savedMapping: saved?.mapping ?? null };
}

export async function importStatement(
  actor: CurrentUser,
  input: {
    accountId: string; fileName: string; bytes: Buffer; mapping: ColumnMappingInput;
    openingBalance: string; closingBalance: string; periodStart?: string; periodEnd?: string;
  },
  meta: RequestMeta,
) {
  const account = await loadAccountFor(prisma, actor, input.accountId, 'reconciliation.manage');
  if (account.type !== 'BANK') throw new AppError('VALIDATION_ERROR', 400, 'Le rapprochement concerne un compte bancaire');
  if (input.bytes.length > MAX_STATEMENT_BYTES) throw new AppError('FILE_TOO_LARGE', 413, 'Fichier trop volumineux (10 Mo maximum)');
  const rows = await readStatementRows(input.fileName, input.bytes).catch(() => {
    throw new AppError('UNSUPPORTED_FILE_TYPE', 415, 'Formats acceptés : CSV ou Excel (.xlsx)');
  });
  const { lines, errors } = applyMapping(rows, input.mapping);
  if (errors.length) throw new AppError('IMPORT_INVALID', 400, `${errors.length} ligne(s) invalide(s) : rien n'a été importé`, errors.slice(0, 50));
  if (lines.length === 0) throw new AppError('VALIDATION_ERROR', 400, 'Aucune ligne exploitable');
  if (lines.length > 5000) throw new AppError('VALIDATION_ERROR', 400, '5000 lignes maximum par relevé');

  const times = lines.map((l) => l.date.getTime());
  const periodStart = input.periodStart ? new Date(input.periodStart) : new Date(Math.min(...times));
  const periodEnd = input.periodEnd ? new Date(input.periodEnd) : new Date(Math.max(...times));
  const opening = D(input.openingBalance);
  const closing = D(input.closingBalance);
  // Cohérence interne du fichier : ouverture + Σ lignes = clôture.
  const net = sum(lines.map((l) => l.amount));
  if (!opening.plus(net).equals(closing)) {
    throw new AppError('STATEMENT_INCOHERENT', 400, 'Le solde d’ouverture + les mouvements ne donnent pas le solde de clôture', {
      opening: fmt(opening), movements: fmt(net), expectedClosing: fmt(opening.plus(net)), closing: fmt(closing),
    });
  }

  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const dupFile = await prisma.bankStatement.findFirst({ where: { accountId: input.accountId, sha256 } });
  if (dupFile) throw new AppError('STATEMENT_ALREADY_IMPORTED', 409, 'Ce fichier a déjà été importé pour ce compte');

  const stored = await putObject(`${account.entityId}/statements/${randomUUID()}`, input.bytes, 'application/octet-stream');
  return prisma.$transaction(async (tx) => {
    const st = await tx.bankStatement.create({
      data: {
        accountId: account.id, entityId: account.entityId, periodStart, periodEnd, openingBalance: opening, closingBalance: closing,
        fileName: input.fileName.slice(0, 150), sha256, fileData: stored.data ? new Uint8Array(stored.data) : null, importedById: actor.id,
      },
    });
    const ids = lines.map(() => randomUUID());
    const matchable: MatchableLine[] = lines.map((l, i) => ({ id: ids[i]!, cents: toCents(fmt(l.amount)), date: l.date, label: l.label, reference: l.reference }));
    const dups = findDuplicates(matchable);
    await tx.bankStatementLine.createMany({
      data: lines.map((l, i) => ({
        id: ids[i]!, statementId: st.id, position: l.position, date: l.date, label: l.label, reference: l.reference,
        amount: l.amount, duplicateOfId: dups.get(ids[i]!) ?? null,
      })),
    });
    await tx.bankColumnMapping.upsert({
      where: { accountId: account.id }, update: { mapping: input.mapping }, create: { accountId: account.id, mapping: input.mapping },
    });
    await writeAudit(tx, {
      actorId: actor.id, action: 'reconciliation.import', entityType: 'Account', entityId: account.id,
      after: { statementId: st.id, fileName: st.fileName, lines: lines.length, sha256, duplicates: dups.size }, ip: meta.ip,
    });
    return { id: st.id, lines: lines.length, duplicates: dups.size };
  });
}

export async function listStatements(actor: CurrentUser, accountId?: string) {
  const rows = await prisma.bankStatement.findMany({
    where: { entityId: { in: accessibleEntityIds(actor) }, ...(accountId ? { accountId } : {}) },
    orderBy: { periodEnd: 'desc' }, take: 100,
    select: { id: true, accountId: true, entityId: true, periodStart: true, periodEnd: true, status: true, fileName: true, importedAt: true },
  });
  const ids = rows.map((r) => r.id);
  const counts = await prisma.bankStatementLine.groupBy({ by: ['statementId', 'matchStatus'], where: { statementId: { in: ids } }, _count: true });
  return rows.map((r) => {
    const mine = counts.filter((c) => c.statementId === r.id);
    const n = (s: string) => mine.find((c) => c.matchStatus === s)?._count ?? 0;
    return { ...r, total: mine.reduce((a, c) => a + c._count, 0), matched: n('MATCHED') + n('CREATED'), pending: n('UNMATCHED') + n('SUGGESTED') };
  });
}

/** Écritures du compte pouvant être rapprochées : transactions actives (ni contre-passées, ni contre-passations), non déjà liées. */
async function freeEntries(db: Tx | typeof prisma, accountId: string, until: Date) {
  const linked = await db.bankStatementLine.findMany({
    where: { matchedEntryId: { not: null }, matchStatus: { in: ['MATCHED', 'CREATED'] } },
    select: { matchedEntryId: true },
  });
  const taken = new Set(linked.map((l) => l.matchedEntryId!));
  const entries = await db.ledgerEntry.findMany({
    where: { accountId, tx: { status: 'POSTED', kind: { notIn: ['REVERSAL', 'OPENING_BALANCE'] }, date: { lte: until } } },
    include: { tx: { select: { reference: true, date: true, description: true, kind: true } } },
    orderBy: { tx: { date: 'asc' } },
  });
  return entries.filter((e) => !taken.has(e.id));
}

type FreeEntry = Awaited<ReturnType<typeof freeEntries>>[number];
const toMatchableEntry = (e: FreeEntry): MatchableEntry => ({ id: e.id, cents: toCents(fmt(D(e.amount))), date: e.tx.date, reference: e.tx.reference });
const entryView = (e: FreeEntry) => ({ id: e.id, date: e.tx.date, reference: e.tx.reference, description: e.tx.description, kind: e.tx.kind, amount: fmt(D(e.amount)) });

/** Lance l'algorithme de suggestion : AUCUNE ligne n'est confirmée ; seul un score 100 unique est pré-coché. */
export async function autoMatch(actor: CurrentUser, id: string, meta: RequestMeta) {
  await loadStatement(actor, id);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BankStatement" WHERE "id" = ${id} FOR UPDATE`;
    const st = await tx.bankStatement.findUniqueOrThrow({ where: { id } });
    if (st.status !== 'IN_PROGRESS') throw new AppError('INVALID_STATE', 409, 'Ce relevé n’est plus modifiable');

    const until = new Date(localDayEnd(localDay(st.periodEnd)).getTime() + WINDOW_DAYS * 86_400_000);
    const free = await freeEntries(tx, st.accountId, until);
    const open = await tx.bankStatementLine.findMany({ where: { statementId: id, matchStatus: { in: ['UNMATCHED', 'SUGGESTED'] } } });
    const outcomes = matchLines(
      open.map((l) => ({ id: l.id, cents: toCents(fmt(D(l.amount))), date: l.date, label: l.label, reference: l.reference })),
      free.map(toMatchableEntry),
    );
    for (const o of outcomes) {
      await tx.bankStatementLine.update({
        where: { id: o.lineId },
        data: o.status === 'SUGGESTED'
          ? { matchStatus: 'SUGGESTED', matchConfidence: o.confidence, candidateIds: o.candidateIds, matchedEntryId: o.preselectedId }
          : { matchStatus: 'UNMATCHED', matchConfidence: null, candidateIds: undefined, matchedEntryId: null },
      });
    }
    await writeAudit(tx, {
      actorId: actor.id, action: 'reconciliation.auto-match', entityType: 'Account', entityId: st.accountId,
      after: { statementId: id, suggested: outcomes.filter((o) => o.status === 'SUGGESTED').length, preselected: outcomes.filter((o) => o.status === 'SUGGESTED' && o.preselectedId).length }, ip: meta.ip,
    });
    return {
      suggested: outcomes.filter((o) => o.status === 'SUGGESTED').length,
      preselected: outcomes.filter((o) => o.status === 'SUGGESTED' && o.preselectedId).length,
      unmatched: outcomes.filter((o) => o.status === 'UNMATCHED').length,
    };
  });
}

/** Verrouille le relevé et retourne la ligne pour une action ; refuse hors statut IN_PROGRESS. */
async function withLine<T>(
  actor: CurrentUser, statementId: string, lineId: string,
  fn: (tx: Tx, st: Awaited<ReturnType<typeof loadStatement>>, line: Prisma.BankStatementLineGetPayload<object>) => Promise<T>,
): Promise<T> {
  await loadStatement(actor, statementId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BankStatement" WHERE "id" = ${statementId} FOR UPDATE`;
    const st = await tx.bankStatement.findUniqueOrThrow({ where: { id: statementId } });
    if (st.status !== 'IN_PROGRESS') throw new AppError('INVALID_STATE', 409, 'Ce relevé n’est plus modifiable');
    const line = await tx.bankStatementLine.findFirst({ where: { id: lineId, statementId } });
    if (!line) throw new AppError('NOT_FOUND', 404, 'Ligne introuvable');
    return fn(tx, st, line);
  });
}

/** Confirmation HUMAINE d'une correspondance (la seule façon de passer une ligne en « rapprochée »). */
export const confirmLine = (actor: CurrentUser, statementId: string, lineId: string, entryId: string | undefined, meta: RequestMeta) =>
  withLine(actor, statementId, lineId, async (tx, st, line) => {
    if (line.matchStatus === 'MATCHED' || line.matchStatus === 'CREATED') throw new AppError('INVALID_STATE', 409, 'Ligne déjà rapprochée');
    const target = entryId ?? line.matchedEntryId;
    if (!target) throw new AppError('VALIDATION_ERROR', 400, 'Choisissez l’écriture à rapprocher');
    const until = new Date(localDayEnd(localDay(st.periodEnd)).getTime() + WINDOW_DAYS * 86_400_000);
    const entry = (await freeEntries(tx, st.accountId, until)).find((e) => e.id === target);
    if (!entry) throw new AppError('ENTRY_UNAVAILABLE', 409, 'Cette écriture n’existe pas, est contre-passée ou est déjà rapprochée');
    if (!D(entry.amount).equals(D(line.amount))) {
      throw new AppError('AMOUNT_MISMATCH', 409, 'Montants différents : corrigez l’opération (contre-passation) ou créez l’écriture manquante', {
        statement: fmt(D(line.amount)), ledger: fmt(D(entry.amount)),
      });
    }
    await tx.bankStatementLine.update({
      where: { id: line.id }, data: { matchStatus: 'MATCHED', matchedEntryId: entry.id, confirmedById: actor.id, confirmedAt: new Date() },
    });
    await writeAudit(tx, {
      actorId: actor.id, action: 'reconciliation.confirm', entityType: 'Account', entityId: st.accountId,
      after: { statementId, lineId, entryId: entry.id, reference: entry.tx.reference, confidence: line.matchConfidence }, ip: meta.ip,
    });
    return { ok: true };
  });

export const unmatchLine = (actor: CurrentUser, statementId: string, lineId: string, meta: RequestMeta) =>
  withLine(actor, statementId, lineId, async (tx, st, line) => {
    if (line.matchStatus === 'CREATED') throw new AppError('INVALID_STATE', 409, 'Une opération créée depuis le relevé se contre-passe, elle ne se « dé-rapproche » pas');
    await tx.bankStatementLine.update({
      where: { id: line.id },
      data: { matchStatus: 'UNMATCHED', matchedEntryId: null, matchConfidence: null, candidateIds: undefined, confirmedById: null, confirmedAt: null, note: null },
    });
    await writeAudit(tx, { actorId: actor.id, action: 'reconciliation.unmatch', entityType: 'Account', entityId: st.accountId, after: { statementId, lineId }, ip: meta.ip });
    return { ok: true };
  });

export const ignoreLine = (actor: CurrentUser, statementId: string, lineId: string, note: string, meta: RequestMeta) =>
  withLine(actor, statementId, lineId, async (tx, st, line) => {
    if (note.trim().length < 3) throw new AppError('REASON_REQUIRED', 400, 'Motif obligatoire pour ignorer une ligne');
    if (line.matchStatus === 'MATCHED' || line.matchStatus === 'CREATED') throw new AppError('INVALID_STATE', 409, 'Ligne déjà rapprochée');
    await tx.bankStatementLine.update({
      where: { id: line.id }, data: { matchStatus: 'IGNORED', matchedEntryId: null, note, confirmedById: actor.id, confirmedAt: new Date() },
    });
    await writeAudit(tx, { actorId: actor.id, action: 'reconciliation.ignore', entityType: 'Account', entityId: st.accountId, after: { statementId, lineId, note }, ip: meta.ip });
    return { ok: true };
  });

/**
 * « Créer l'opération » depuis une ligne du relevé non enregistrée :
 * débit ⇒ frais bancaires ; crédit ⇒ recette (catégorie obligatoire). La ligne passe en CREATED, liée à l'écriture créée.
 */
export const createFromLine = (
  actor: CurrentUser, statementId: string, lineId: string, input: { categoryId?: string; description?: string }, meta: RequestMeta,
) =>
  withLine(actor, statementId, lineId, async (tx, st, line) => {
    if (line.matchStatus === 'MATCHED' || line.matchStatus === 'CREATED') throw new AppError('INVALID_STATE', 409, 'Ligne déjà rapprochée');
    const amount = D(line.amount);
    const description = input.description ?? line.label;
    const date = line.date.toISOString();
    let txRef: { id: string; reference: string };
    if (amount.isNegative()) {
      txRef = await recordBankFeeTx(tx, actor, { bankAccountId: st.accountId, amount: fmt(amount.abs()), description, date }, meta);
    } else {
      if (!input.categoryId) throw new AppError('VALIDATION_ERROR', 400, 'Choisissez la catégorie de la recette');
      const account = await tx.account.findUniqueOrThrow({ where: { id: st.accountId } });
      const income = await recordIncome(tx, actor, {
        entityId: st.entityId, accountId: st.accountId, categoryId: input.categoryId, source: description.slice(0, 160),
        amount: fmt(amount), currency: account.currency, paymentMethod: 'BANK_TRANSFER', date,
      }, meta);
      const t = await tx.financialTransaction.findFirstOrThrow({ where: { reference: income.reference }, select: { id: true, reference: true } });
      txRef = t;
    }
    const entry = await tx.ledgerEntry.findFirstOrThrow({ where: { txId: txRef.id, accountId: st.accountId } });
    await tx.bankStatementLine.update({
      where: { id: line.id },
      data: { matchStatus: 'CREATED', matchedEntryId: entry.id, confirmedById: actor.id, confirmedAt: new Date(), note: `Créée : ${txRef.reference}` },
    });
    await writeAudit(tx, {
      actorId: actor.id, action: 'reconciliation.create-transaction', entityType: 'Account', entityId: st.accountId,
      after: { statementId, lineId, reference: txRef.reference, amount: fmt(amount) }, ip: meta.ip,
    });
    return { reference: txRef.reference };
  });

/** Vue à quatre colonnes + état de rapprochement (solde relevé vs solde comptable, suspens, écart final). */
export async function getStatement(actor: CurrentUser, id: string) {
  const st = await loadStatement(actor, id);
  const account = await prisma.account.findUniqueOrThrow({ where: { id: st.accountId }, select: { name: true, currency: true } });
  const lines = await prisma.bankStatementLine.findMany({ where: { statementId: id }, orderBy: { position: 'asc' } });
  const periodEndExact = localDayEnd(localDay(st.periodEnd));
  const free = await freeEntries(prisma, st.accountId, periodEndExact);
  const linkedIds = lines.filter((l) => l.matchedEntryId && (l.matchStatus === 'MATCHED' || l.matchStatus === 'CREATED' || l.matchStatus === 'SUGGESTED')).map((l) => l.matchedEntryId!);
  const linkedEntries = linkedIds.length
    ? await prisma.ledgerEntry.findMany({ where: { id: { in: linkedIds } }, include: { tx: { select: { reference: true, date: true, description: true, kind: true } } } })
    : [];
  const entryById = new Map<string, FreeEntry>([...linkedEntries, ...free].map((e) => [e.id, e as FreeEntry]));

  // Écarts de montant : même référence que le libellé du relevé mais montant différent.
  const unmatched = lines.filter((l) => l.matchStatus === 'UNMATCHED');
  const diffs = matchLines(
    unmatched.map((l) => ({ id: l.id, cents: toCents(fmt(D(l.amount))), date: l.date, label: l.label, reference: l.reference })),
    free.map(toMatchableEntry),
  );
  const diffByLine = new Map(diffs.map((o) => [o.lineId, o.status === 'UNMATCHED' ? o.amountDiffEntryId : null]));

  const lineView = (l: (typeof lines)[number]) => {
    const cands = ((l.candidateIds as string[] | null) ?? []).map((cid) => entryById.get(cid) ?? free.find((e) => e.id === cid)).filter((e): e is FreeEntry => Boolean(e));
    const diffEntry = diffByLine.get(l.id) ? entryById.get(diffByLine.get(l.id)!) : null;
    return {
      id: l.id, position: l.position, date: l.date, label: l.label, reference: l.reference, amount: fmt(D(l.amount)),
      status: l.matchStatus, confidence: l.matchConfidence, preselectedEntryId: l.matchStatus === 'SUGGESTED' ? l.matchedEntryId : null,
      matchedEntry: l.matchedEntryId && l.matchStatus !== 'SUGGESTED' ? (entryById.has(l.matchedEntryId) ? entryView(entryById.get(l.matchedEntryId)!) : null) : null,
      candidates: l.matchStatus === 'SUGGESTED' ? cands.map(entryView) : [],
      amountDiffEntry: diffEntry ? entryView(diffEntry) : null,
      duplicateOfId: l.duplicateOfId, note: l.note,
    };
  };
  const views = lines.map(lineView);

  // Rapprochement chiffré.
  const ledgerBalance = await getAccountBalance(prisma, st.accountId, periodEndExact);
  const outstandingEntries = sum(free.map((e) => D(e.amount)));
  const unrecordedLines = sum(lines.filter((l) => !['MATCHED', 'CREATED'].includes(l.matchStatus)).map((l) => D(l.amount)));
  const expectedLedger = D(st.closingBalance).plus(outstandingEntries).minus(unrecordedLines);
  const difference = ledgerBalance.minus(expectedLedger);

  return {
    id: st.id, accountId: st.accountId, accountName: account.name, currency: account.currency, entityId: st.entityId, status: st.status, fileName: st.fileName,
    submittedById: st.submittedById,
    periodStart: st.periodStart, periodEnd: st.periodEnd, importedAt: st.importedAt, validationNote: st.validationNote,
    columns: {
      matched: views.filter((v) => v.status === 'MATCHED' || v.status === 'CREATED' || v.status === 'SUGGESTED'),
      unrecorded: views.filter((v) => (v.status === 'UNMATCHED' && !v.amountDiffEntry) || v.status === 'IGNORED'),
      missingFromStatement: free.map(entryView),
      amountDifferences: views.filter((v) => v.status === 'UNMATCHED' && v.amountDiffEntry),
      duplicates: views.filter((v) => v.duplicateOfId),
    },
    reconciliation: {
      statementOpening: fmt(D(st.openingBalance)), statementClosing: fmt(D(st.closingBalance)),
      ledgerBalance: fmt(ledgerBalance), outstandingEntries: fmt(outstandingEntries), unrecordedStatementLines: fmt(unrecordedLines),
      difference: fmt(difference), balanced: difference.isZero(),
    },
  };
}

export async function submitStatement(actor: CurrentUser, id: string, meta: RequestMeta) {
  await loadStatement(actor, id);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BankStatement" WHERE "id" = ${id} FOR UPDATE`;
    const st = await tx.bankStatement.findUniqueOrThrow({ where: { id } });
    if (st.status !== 'IN_PROGRESS') throw new AppError('INVALID_STATE', 409, 'Relevé déjà soumis');
    const pending = await tx.bankStatementLine.count({ where: { statementId: id, matchStatus: 'SUGGESTED' } });
    if (pending > 0) throw new AppError('LINES_PENDING', 409, `${pending} correspondance(s) suggérée(s) à confirmer, ignorer ou annuler avant de soumettre`);
    await tx.bankStatement.update({ where: { id }, data: { status: 'SUBMITTED', submittedById: actor.id, submittedAt: new Date() } });
    await writeAudit(tx, { actorId: actor.id, action: 'reconciliation.submit', entityType: 'Account', entityId: st.accountId, after: { statementId: id }, ip: meta.ip });
    return { status: 'SUBMITTED' as const };
  });
}

/** Validation : autre personne que celle qui a soumis, step-up, et écart nul — sinon note d'acceptation obligatoire. */
export async function validateStatement(actor: CurrentUser, id: string, note: string | undefined, meta: RequestMeta) {
  const pre = await loadStatement(actor, id);
  if (pre.submittedById === actor.id) throw new AppError('SEPARATION_OF_DUTIES', 403, 'La validation est faite par une autre personne que celle qui a soumis');
  requireStepUp(actor); // SPEC §9
  const report = await getStatement(actor, id);
  if (!report.reconciliation.balanced && (note ?? '').trim().length < 5) {
    throw new AppError('RECONCILIATION_UNBALANCED', 409, `Écart de ${report.reconciliation.difference} : une note d'acceptation est obligatoire`, report.reconciliation);
  }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BankStatement" WHERE "id" = ${id} FOR UPDATE`;
    const st = await tx.bankStatement.findUniqueOrThrow({ where: { id } });
    if (st.status !== 'SUBMITTED') throw new AppError('INVALID_STATE', 409, 'Le relevé doit d’abord être soumis');
    await tx.bankStatement.update({ where: { id }, data: { status: 'VALIDATED', validatedById: actor.id, validatedAt: new Date(), validationNote: note?.trim() || null } });
    await writeAudit(tx, {
      actorId: actor.id, action: 'reconciliation.validate', entityType: 'Account', entityId: st.accountId,
      before: { status: 'SUBMITTED' }, after: { status: 'VALIDATED', difference: report.reconciliation.difference, note: note ?? null }, ip: meta.ip,
    });
    return { status: 'VALIDATED' as const, difference: report.reconciliation.difference };
  });
}

