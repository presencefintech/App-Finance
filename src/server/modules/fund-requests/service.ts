import 'server-only';
import { randomUUID } from 'node:crypto';
import type { FundRequest, Prisma } from '@/generated/prisma/client';
import type { FundRequestStatus, Role } from '@/generated/prisma/enums';
import type {
  CreateFundRequestInput, ListFundRequestsInput, UpdateFundRequestInput,
} from '@/lib/schemas/fund-requests';
import { roleHasPermission } from '@/lib/permissions';
import type { Paginated } from '@/lib/schemas/common';
import { writeAudit } from '@/server/audit';
import type { CurrentUser, RequestMeta } from '@/server/auth';
import { prisma } from '@/server/db';
import { AppError } from '@/server/errors';
import { postTransaction } from '@/server/ledger';
import { D, toMoneyString } from '@/server/money';
import { notifyRole, notifyUsers } from '@/server/notifications';
import { accessibleEntityIds, assertCan } from '@/server/permissions';
import { nextReference } from '@/server/references';
import { allowSameApproverCashier, approvalLimit, stepUpApprovalThreshold } from '@/server/settings';
import { openAdvanceForExpense } from '../advances/service';
import { budgetWarningsForRequest } from '../budgets/service';
import { requireStepUp } from '@/server/totp';

type Tx = Prisma.TransactionClient;

/** Rôles qui voient toutes les demandes d'une entité (un REQUESTER ne voit que les siennes). */
const VIEW_ALL_ROLES: Role[] = ['CONTROLLER', 'DIRECTOR', 'CASHIER', 'VIEWER'];

const hasRole = (u: CurrentUser, entityId: string, role: Role) =>
  u.roles.some((r) => r.entityId === entityId && r.role === role);

const href = (id: string) => `/demandes/${id}`;
const notFound = () => new AppError('NOT_FOUND', 404, 'Demande introuvable');
const badState = (status: FundRequestStatus, action: string) =>
  new AppError('INVALID_STATE', 409, `Action « ${action} » impossible : la demande est « ${status} »`);

export interface FundRequestView {
  id: string; reference: string; entityId: string; requesterId: string; requesterName: string | null;
  departmentId: string | null; amount: string; currency: 'USD' | 'CDF'; purpose: string;
  status: FundRequestStatus; submittedAt: Date | null; approvalLevel: string | null;
  disbursedFromAccountId: string | null; createdAt: Date;
}

async function toView(rows: FundRequest[]): Promise<FundRequestView[]> {
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.requesterId))] } },
    select: { id: true, fullName: true },
  });
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({
    id: r.id, reference: r.reference, entityId: r.entityId, requesterId: r.requesterId,
    requesterName: names.get(r.requesterId) ?? null, departmentId: r.departmentId,
    amount: toMoneyString(D(r.amount)), currency: r.currency, purpose: r.purpose, status: r.status,
    submittedAt: r.submittedAt, approvalLevel: r.approvalLevel,
    disbursedFromAccountId: r.disbursedFromAccountId, createdAt: r.createdAt,
  }));
}

/** Charge la demande en appliquant l'isolation d'entité et la visibilité par rôle (même 404 sinon). */
async function loadVisible(actor: CurrentUser, id: string): Promise<FundRequest> {
  const req = await prisma.fundRequest.findUnique({ where: { id } });
  if (!req || !accessibleEntityIds(actor).includes(req.entityId)) throw notFound();
  const seesAll = VIEW_ALL_ROLES.some((r) => hasRole(actor, req.entityId, r));
  if (!seesAll && req.requesterId !== actor.id) throw notFound();
  return req;
}

export async function listFundRequests(
  actor: CurrentUser,
  q: Partial<ListFundRequestsInput> & { page: number; pageSize: number },
): Promise<Paginated<FundRequestView>> {
  const allowed = accessibleEntityIds(actor);
  const entityIds = q.entityId ? allowed.filter((id) => id === q.entityId) : allowed;
  // Par entité : « tout voir » ou seulement ses propres demandes.
  const or: Prisma.FundRequestWhereInput[] = entityIds.map((entityId) =>
    VIEW_ALL_ROLES.some((r) => hasRole(actor, entityId, r)) ? { entityId } : { entityId, requesterId: actor.id },
  );
  const where: Prisma.FundRequestWhereInput = {
    OR: or.length ? or : [{ id: '__none__' }],
    ...(q.status ? { status: q.status } : {}),
    ...(q.requesterId ? { requesterId: q.requesterId } : {}),
    ...(q.from || q.to
      ? { createdAt: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.fundRequest.count({ where }),
    prisma.fundRequest.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
    }),
  ]);
  return { data: await toView(rows), page: q.page, pageSize: q.pageSize, total };
}

export async function getFundRequest(actor: CurrentUser, id: string) {
  const req = await loadVisible(actor, id);
  const [events, attachments, [view]] = await Promise.all([
    prisma.fundRequestEvent.findMany({ where: { fundRequestId: id }, orderBy: { at: 'asc' } }),
    prisma.attachment.findMany({
      where: { fundRequestId: id },
      select: { id: true, fileName: true, mimeType: true, size: true, kind: true, uploadedAt: true },
      orderBy: { uploadedAt: 'asc' },
    }),
    toView([req]),
  ]);
  const actorIds = [...new Set(events.map((e) => e.actorId))];
  const users = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } });
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  return {
    ...view!,
    events: events.map((e) => ({
      id: e.id, fromStatus: e.fromStatus, toStatus: e.toStatus, comment: e.comment, at: e.at,
      actorName: names.get(e.actorId) ?? 'Inconnu',
    })),
    attachments,
  };
}

/** Transition atomique : mise à jour conditionnelle au statut, événement d'historique, audit. */
async function move(
  tx: Tx, req: FundRequest, to: FundRequestStatus, actor: CurrentUser, meta: RequestMeta,
  opts: { comment?: string; data?: Prisma.FundRequestUncheckedUpdateManyInput; action: string },
) {
  const { count } = await tx.fundRequest.updateMany({
    where: { id: req.id, status: req.status },
    data: { status: to, ...opts.data },
  });
  if (count !== 1) throw new AppError('CONFLICT', 409, 'La demande vient d’être modifiée, rechargez la page');
  await tx.fundRequestEvent.create({
    data: { fundRequestId: req.id, fromStatus: req.status, toStatus: to, actorId: actor.id, comment: opts.comment || null },
  });
  await writeAudit(tx, {
    actorId: actor.id, action: `fundRequest.${opts.action}`, entityType: 'FundRequest', entityId: req.id,
    before: { status: req.status }, after: { status: to, comment: opts.comment ?? null }, ip: meta.ip,
  });
}

/** Charge la demande verrouillée dans la transaction : plus aucune course possible entre acteurs. */
async function lock(tx: Tx, id: string): Promise<FundRequest> {
  await tx.$queryRaw`SELECT "id" FROM "FundRequest" WHERE "id" = ${id} FOR UPDATE`;
  return tx.fundRequest.findUniqueOrThrow({ where: { id } });
}

export async function createFundRequest(actor: CurrentUser, input: CreateFundRequestInput, meta: RequestMeta) {
  if (!accessibleEntityIds(actor).includes(input.entityId)) throw new AppError('FORBIDDEN', 403, 'Entité inaccessible');
  assertCan(actor, 'fundRequest.create', input.entityId);

  return prisma.$transaction(async (tx) => {
    if (input.departmentId) {
      const dep = await tx.department.findFirst({ where: { id: input.departmentId, entityId: input.entityId } });
      if (!dep) throw new AppError('VALIDATION_ERROR', 400, 'Département inconnu pour cette entité');
    }
    const reference = await nextReference(tx, input.entityId, 'DF');
    const created = await tx.fundRequest.create({
      data: {
        reference, entityId: input.entityId, requesterId: actor.id, departmentId: input.departmentId,
        amount: input.amount, currency: input.currency, purpose: input.purpose,
      },
    });
    await tx.fundRequestEvent.create({
      data: { fundRequestId: created.id, fromStatus: null, toStatus: 'DRAFT', actorId: actor.id },
    });
    await writeAudit(tx, {
      actorId: actor.id, action: 'fundRequest.create', entityType: 'FundRequest', entityId: created.id,
      after: { reference, amount: input.amount, currency: input.currency }, ip: meta.ip,
    });
    if (input.submit) await doSubmit(tx, created, actor, meta);
    return (await toView([await tx.fundRequest.findUniqueOrThrow({ where: { id: created.id } })]))[0]!;
  });
}

export async function updateFundRequest(actor: CurrentUser, id: string, input: UpdateFundRequestInput, meta: RequestMeta) {
  await loadVisible(actor, id);
  return prisma.$transaction(async (tx) => {
    const req = await lock(tx, id);
    if (req.requesterId !== actor.id) throw new AppError('FORBIDDEN', 403, 'Seul le demandeur peut modifier le brouillon');
    if (req.status !== 'DRAFT') throw badState(req.status, 'modifier');
    const after = await tx.fundRequest.update({ where: { id }, data: input });
    await writeAudit(tx, {
      actorId: actor.id, action: 'fundRequest.update', entityType: 'FundRequest', entityId: id,
      before: { amount: toMoneyString(D(req.amount)), currency: req.currency, purpose: req.purpose },
      after: { amount: toMoneyString(D(after.amount)), currency: after.currency, purpose: after.purpose }, ip: meta.ip,
    });
    return (await toView([after]))[0]!;
  });
}

async function doSubmit(tx: Tx, req: FundRequest, actor: CurrentUser, meta: RequestMeta) {
  if (req.requesterId !== actor.id) throw new AppError('FORBIDDEN', 403, 'Seul le demandeur peut soumettre');
  if (req.status !== 'DRAFT') throw badState(req.status, 'soumettre');
  await move(tx, req, 'SUBMITTED', actor, meta, { action: 'submit', data: { submittedAt: new Date() } });
  await notifyRole(tx, req.entityId, ['CONTROLLER'], {
    title: 'Nouvelle demande de fonds',
    body: `${req.reference} — ${toMoneyString(D(req.amount))} ${req.currency}`, href: href(req.id),
  }, actor.id);
}

/** Exécute une action de la machine à états sur la demande verrouillée. */
async function act(
  actor: CurrentUser, id: string,
  fn: (tx: Tx, req: FundRequest) => Promise<void>,
) {
  await loadVisible(actor, id);
  await prisma.$transaction(async (tx) => fn(tx, await lock(tx, id)));
  return getFundRequest(actor, id);
}

/**
 * Variante pour le décaissement : un caissier de l'AUTRE entité (prêteuse) doit pouvoir décaisser sans voir
 * le détail de la demande. Les contrôles fins (rôle dans l'entité prêteuse, confirmation) sont dans l'action.
 */
async function actCross(
  actor: CurrentUser, id: string,
  fn: (tx: Tx, req: FundRequest) => Promise<void>,
): Promise<{ id: string; reference: string; status: FundRequestStatus }> {
  const probe = await prisma.fundRequest.findUnique({ where: { id }, select: { id: true } });
  if (!probe) throw notFound();
  await prisma.$transaction(async (tx) => fn(tx, await lock(tx, id)));
  const r = await prisma.fundRequest.findUniqueOrThrow({ where: { id } });
  return { id: r.id, reference: r.reference, status: r.status };
}

export const submitFundRequest = (actor: CurrentUser, id: string, meta: RequestMeta) =>
  act(actor, id, (tx, req) => doSubmit(tx, req, actor, meta));

export const reviewFundRequest = (actor: CurrentUser, id: string, meta: RequestMeta) =>
  act(actor, id, async (tx, req) => {
    assertCan(actor, 'fundRequest.review', req.entityId);
    if (req.requesterId === actor.id) throw new AppError('SEPARATION_OF_DUTIES', 403, 'Vous ne pouvez pas examiner votre propre demande');
    if (req.status !== 'SUBMITTED') throw badState(req.status, 'examiner');
    await move(tx, req, 'UNDER_REVIEW', actor, meta, { action: 'review' });
  });

/** Renvoie la demande ET d'éventuels avertissements budgétaires (non bloquants en v1). */
export async function approveFundRequest(actor: CurrentUser, id: string, comment: string | undefined, meta: RequestMeta) {
  let warnings: string[] = [];
  const view = await act(actor, id, async (tx, req) => {
    assertCan(actor, 'fundRequest.approve', req.entityId);
    if (req.requesterId === actor.id) throw new AppError('SEPARATION_OF_DUTIES', 403, 'Vous ne pouvez pas approuver votre propre demande');

    const isDirector = hasRole(actor, req.entityId, 'DIRECTOR');
    const isController = hasRole(actor, req.entityId, 'CONTROLLER');
    const amount = D(req.amount);
    let level: 'CONTROLLER' | 'DIRECTOR';

    if (req.status === 'ESCALATED') {
      if (!isDirector) throw new AppError('FORBIDDEN', 403, 'Seule la direction peut statuer sur une demande transmise');
      level = 'DIRECTOR';
    } else if (req.status === 'UNDER_REVIEW' || (req.status === 'SUBMITTED' && isDirector)) {
      if (isDirector) {
        level = 'DIRECTOR';
      } else if (isController) {
        level = 'CONTROLLER';
      } else {
        throw new AppError('FORBIDDEN', 403, 'Rôle insuffisant');
      }
    } else {
      throw badState(req.status, 'approuver');
    }

    const limit = await approvalLimit(tx, req.entityId, level, req.currency);
    if (limit && amount.greaterThan(limit)) {
      throw new AppError('APPROVAL_LIMIT_EXCEEDED', 409,
        'Montant supérieur à votre plafond : transmettez la demande au chef', {
          limit: toMoneyString(limit), amount: toMoneyString(amount), currency: req.currency,
        });
    }
    // Step-up : toujours pour la direction, au-delà d'un seuil pour la contrôleuse (SPEC §9).
    if (level === 'DIRECTOR' || amount.greaterThan(stepUpApprovalThreshold(req.currency))) requireStepUp(actor);

    warnings = await budgetWarningsForRequest(tx, req);
    const fullComment = [comment, ...warnings.map((w) => `⚠ ${w}`)].filter(Boolean).join(' — ') || undefined;
    await move(tx, req, 'APPROVED', actor, meta, {
      action: 'approve', comment: fullComment,
      data: { approvalLevel: level, approvedById: actor.id, approvedAt: new Date() },
    });
    // Approuvé ≠ décaissé (règle 8) : aucune écriture comptable ici.
    await notifyUsers(tx, [req.requesterId], { title: 'Demande approuvée', body: `${req.reference} est approuvée, en attente de décaissement`, href: href(id) });
    await notifyRole(tx, req.entityId, ['CASHIER'], { title: 'Demande à décaisser', body: `${req.reference} — ${toMoneyString(amount)} ${req.currency}`, href: href(id) }, actor.id);
  });
  return { ...view, warnings };
}

export const escalateFundRequest = (actor: CurrentUser, id: string, comment: string | undefined, meta: RequestMeta) =>
  act(actor, id, async (tx, req) => {
    assertCan(actor, 'fundRequest.review', req.entityId);
    if (req.requesterId === actor.id) throw new AppError('SEPARATION_OF_DUTIES', 403, 'Vous ne pouvez pas traiter votre propre demande');
    if (req.status !== 'UNDER_REVIEW') throw badState(req.status, 'transmettre');
    await move(tx, req, 'ESCALATED', actor, meta, { action: 'escalate', comment });
    await notifyRole(tx, req.entityId, ['DIRECTOR'], {
      title: 'Demande transmise pour décision', body: `${req.reference} — ${toMoneyString(D(req.amount))} ${req.currency}`, href: href(id),
    }, actor.id);
  });

export const rejectFundRequest = (actor: CurrentUser, id: string, comment: string, meta: RequestMeta) =>
  act(actor, id, async (tx, req) => {
    if (comment.trim().length < 3) throw new AppError('REASON_REQUIRED', 400, 'Commentaire obligatoire pour un rejet');
    assertCan(actor, 'fundRequest.approve', req.entityId);
    if (req.requesterId === actor.id) throw new AppError('SEPARATION_OF_DUTIES', 403, 'Vous ne pouvez pas rejeter votre propre demande');
    const isDirector = hasRole(actor, req.entityId, 'DIRECTOR');
    const allowed = req.status === 'UNDER_REVIEW' || (isDirector && (req.status === 'ESCALATED' || req.status === 'SUBMITTED'));
    if (!allowed) throw badState(req.status, 'rejeter');
    if (req.status === 'ESCALATED' && !isDirector) throw new AppError('FORBIDDEN', 403, 'Seule la direction peut statuer');
    await move(tx, req, 'REJECTED', actor, meta, { action: 'reject', comment });
    await notifyUsers(tx, [req.requesterId], { title: 'Demande rejetée', body: `${req.reference} : ${comment}`, href: href(id) });
  });

export const cancelFundRequest = (actor: CurrentUser, id: string, meta: RequestMeta) =>
  act(actor, id, async (tx, req) => {
    if (req.requesterId !== actor.id) throw new AppError('FORBIDDEN', 403, 'Seul le demandeur peut annuler');
    if (req.status !== 'DRAFT' && req.status !== 'SUBMITTED') throw badState(req.status, 'annuler');
    await move(tx, req, 'CANCELLED', actor, meta, { action: 'cancel' });
  });

/**
 * Décaissement : seul acte qui crée des écritures (règle 8).
 * Dépense + transaction comptable dans UNE transaction DB ; compte verrouillé par le ledger.
 */
export const disburseFundRequest = (
  actor: CurrentUser, id: string,
  input: { accountId: string; categoryId?: string; confirmAdvance?: boolean }, meta: RequestMeta,
) =>
  actCross(actor, id, async (tx, req) => {
    // Refus par permission d'abord : il faut être caissier quelque part (le rôle dans l'entité du compte est vérifié plus bas).
    if (!actor.roles.some((r) => roleHasPermission(r.role, 'fundRequest.disburse'))) {
      throw new AppError('FORBIDDEN', 403, 'Action non autorisée');
    }
    if (req.status !== 'APPROVED') throw badState(req.status, 'décaisser');
    if (req.requesterId === actor.id) throw new AppError('SEPARATION_OF_DUTIES', 403, 'Vous ne pouvez pas décaisser votre propre demande');
    let sameApproverOverride = false;
    if (req.approvedById === actor.id) {
      if (!(await allowSameApproverCashier(tx))) {
        throw new AppError('SEPARATION_OF_DUTIES', 403, "L'approbateur ne peut pas décaisser la même demande");
      }
      sameApproverOverride = true;
    }
    requireStepUp(actor);

    const account = await tx.account.findUnique({ where: { id: input.accountId } });
    if (!account || !accessibleEntityIds(actor).includes(account.entityId)) throw new AppError('NOT_FOUND', 404, 'Compte introuvable');
    // Le caissier doit l'être dans l'entité qui détient l'argent (le compte débité).
    assertCan(actor, 'fundRequest.disburse', account.entityId);
    if (account.currency !== req.currency) {
      throw new AppError('CURRENCY_MISMATCH', 400, 'La devise du compte doit être celle de la demande');
    }

    const requester = await tx.user.findUniqueOrThrow({ where: { id: req.requesterId }, select: { fullName: true } });

    if (account.entityId !== req.entityId) {
      // Règle 7 : décaisser depuis l'autre entité = avance inter-entités (créance / dette), jamais une dépense du prêteur.
      if (!input.confirmAdvance) {
        const [lender, borrower] = await Promise.all([
          tx.entity.findUniqueOrThrow({ where: { id: account.entityId }, select: { name: true } }),
          tx.entity.findUniqueOrThrow({ where: { id: req.entityId }, select: { name: true } }),
        ]);
        throw new AppError('ADVANCE_CONFIRMATION_REQUIRED', 409,
          `${account.name} (${lender.name}) va avancer ${toMoneyString(D(req.amount))} ${req.currency} à ${borrower.name}. Confirmez l'avance inter-entités.`, {
            lender: lender.name, borrower: borrower.name, amount: toMoneyString(D(req.amount)), currency: req.currency,
          });
      }
      await openAdvanceForExpense(tx, actor, {
        lender: account, borrowerEntityId: req.entityId, amount: D(req.amount), date: new Date(),
        description: `Demande ${req.reference} — ${req.purpose.slice(0, 120)}`,
        beneficiary: requester.fullName, purpose: req.purpose, categoryId: input.categoryId,
        departmentId: req.departmentId, fundRequestId: req.id,
      }, meta);
      await move(tx, req, 'DISBURSED', actor, meta, {
        action: 'disburse',
        comment: `Avance inter-entités : fonds avancés par ${account.name}`,
        data: { disbursedFromAccountId: account.id, disbursedById: actor.id, disbursedAt: new Date() },
      });
      await notifyUsers(tx, [req.requesterId], {
        title: 'Fonds décaissés (avance)', body: `${req.reference} : confirmez la réception des fonds`, href: href(id),
      });
      return;
    }

    let categoryId = input.categoryId;
    if (!categoryId) {
      const cat = await tx.category.upsert({
        where: { entityId_kind_name: { entityId: req.entityId, kind: 'EXPENSE', name: 'Demandes de fonds' } },
        update: {}, create: { entityId: req.entityId, kind: 'EXPENSE', name: 'Demandes de fonds' },
      });
      categoryId = cat.id;
    } else {
      const cat = await tx.category.findFirst({ where: { id: categoryId, entityId: req.entityId, kind: 'EXPENSE' } });
      if (!cat) throw new AppError('VALIDATION_ERROR', 400, 'Catégorie de dépense inconnue');
    }

    const expenseId = randomUUID();
    const posted = await postTransaction(tx, {
      entityId: req.entityId, kind: 'EXPENSE', date: new Date(),
      description: `Décaissement ${req.reference} — ${req.purpose.slice(0, 120)}`,
      createdById: actor.id,
      lines: [{ accountId: account.id, amount: D(req.amount).negated() }],
      links: { fundRequestId: req.id, expenseId }, ip: meta.ip,
    });
    await tx.expense.create({
      data: {
        id: expenseId, reference: posted.reference, entityId: req.entityId, date: posted.date, categoryId,
        departmentId: req.departmentId, beneficiary: requester.fullName, purpose: req.purpose,
        amount: req.amount, currency: req.currency,
        paymentMethod: account.type === 'CASH' ? 'CASH' : 'BANK_TRANSFER',
        accountId: account.id, fundRequestId: req.id, createdById: actor.id,
      },
    });
    await move(tx, req, 'DISBURSED', actor, meta, {
      action: 'disburse',
      comment: sameApproverOverride ? "Approbateur = caissier (option « allowSameApproverCashier » active)" : undefined,
      data: { disbursedFromAccountId: account.id, disbursedById: actor.id, disbursedAt: new Date() },
    });
    await notifyUsers(tx, [req.requesterId], {
      title: 'Fonds décaissés', body: `${req.reference} : confirmez la réception des fonds`, href: href(id),
    });
  });

export const confirmReceipt = (actor: CurrentUser, id: string, meta: RequestMeta) =>
  act(actor, id, async (tx, req) => {
    if (req.requesterId !== actor.id) throw new AppError('FORBIDDEN', 403, 'Seul le demandeur confirme la réception');
    if (req.status !== 'DISBURSED') throw badState(req.status, 'confirmer la réception');
    await move(tx, req, 'RECEIVED', actor, meta, { action: 'confirm-receipt', data: { receivedAt: new Date() } });
    await notifyRole(tx, req.entityId, ['CONTROLLER'], { title: 'Fonds reçus', body: `${req.reference} : justificatifs attendus`, href: href(id) }, actor.id);
  });

export const justifyFundRequest = (actor: CurrentUser, id: string, comment: string | undefined, meta: RequestMeta) =>
  act(actor, id, async (tx, req) => {
    if (req.requesterId !== actor.id) throw new AppError('FORBIDDEN', 403, 'Seul le demandeur dépose les justificatifs');
    if (req.status !== 'RECEIVED') throw badState(req.status, 'justifier');
    const count = await tx.attachment.count({ where: { fundRequestId: id } });
    if (count === 0) throw new AppError('ATTACHMENT_REQUIRED', 409, 'Joignez au moins un justificatif');
    await move(tx, req, 'JUSTIFIED', actor, meta, { action: 'justify', comment });
    await notifyRole(tx, req.entityId, ['CONTROLLER'], { title: 'Justificatifs déposés', body: `${req.reference} à clôturer`, href: href(id) }, actor.id);
  });

export const closeFundRequest = (actor: CurrentUser, id: string, comment: string | undefined, meta: RequestMeta) =>
  act(actor, id, async (tx, req) => {
    assertCan(actor, 'fundRequest.close', req.entityId);
    if (req.requesterId === actor.id) throw new AppError('SEPARATION_OF_DUTIES', 403, 'La clôture est faite par un autre contrôleur que le demandeur');
    if (req.status !== 'JUSTIFIED') throw badState(req.status, 'clôturer');
    await move(tx, req, 'CLOSED', actor, meta, { action: 'close', comment, data: { closedById: actor.id, closedAt: new Date() } });
    await notifyUsers(tx, [req.requesterId], { title: 'Demande clôturée', body: req.reference, href: href(id) });
  });
