/**
 * Données de démonstration — DEUX organisations clientes séparées (SEC SARL et École), chacune avec ses propres
 * utilisateurs, comptes, historique, demandes, budgets et relevé à rapprocher.
 *
 * Passe par les VRAIS services (grand livre, circuit d'approbation, budgets, rapprochement) et par la Row-Level
 * Security : chaque organisation est peuplée dans SON contexte, comme le ferait l'application.
 * Prérequis : le seed de base (organisations + administrateurs). Rejouable sans risque (marqueur « demoSeeded »).
 *
 *   pnpm db:seed:demo        (à lancer uniquement sur un environnement de TEST / staging)
 */
import 'dotenv/config';
import argon2 from 'argon2';

if (!process.argv.includes('--yes')) {
  console.error('Refusé : ajoutez --yes pour confirmer que la cible est un environnement de test.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('Refusé : NODE_ENV=production. Définissez ALLOW_DEMO_SEED=true si vous êtes SÛR de vouloir des données fictives ici.');
  process.exit(1);
}

const DEMO_PASSWORD = 'Demo-Finance-2026';
const META = { ip: '127.0.0.1', userAgent: 'seed-demo' };
const DAY = 86_400_000;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// PRNG déterministe : mêmes données à chaque exécution.
let seedState = 20261113;
const rnd = () => {
  seedState |= 0; seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
const money = (n: number) => n.toFixed(2);
const round = (n: number, step: number) => Math.round(n / step) * step;
const dayStr = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY + 2 * 3600_000).toISOString().slice(0, 10);

type Role = import('../src/generated/prisma/enums').Role;
type Actor = import('../src/server/auth').CurrentUser;
type Cur = 'USD' | 'CDF';

interface OrgConfig {
  slug: string;
  entityCode: string;
  label: string;
  /** Suffixe des e-mails de démo : controleuse.<suffix>@sec.local … */
  suffix: string;
  people: { key: string; local: string; fullName: string; role: Role }[];
  departments: string[];
  /** Catégorie de recette « principale » et libellés. */
  incomeMain: string;
  scale: number;
}

const PEOPLE = (names: Record<string, string>): OrgConfig['people'] => [
  { key: 'ctrl', local: 'controleuse', fullName: names.ctrl!, role: 'CONTROLLER' },
  { key: 'dir', local: 'directeur', fullName: names.dir!, role: 'DIRECTOR' },
  { key: 'cash', local: 'caissier', fullName: names.cash!, role: 'CASHIER' },
  { key: 'req', local: 'demandeur', fullName: names.req!, role: 'REQUESTER' },
  { key: 'view', local: 'lecteur', fullName: names.view!, role: 'VIEWER' },
];

const ORGS: OrgConfig[] = [
  {
    slug: 'sec-sarl', entityCode: 'SEC', label: 'SEC SARL', suffix: 'sec', incomeMain: 'Partenaires', scale: 1,
    departments: ['Informatique', 'Logistique', 'Administration'],
    people: PEOPLE({ ctrl: 'Marie Kabongo (Contrôleuse)', dir: 'Jean-Paul Mutombo (Direction)', cash: 'Patrick Ilunga (Caissier)', req: 'Alain Kasongo (Demandeur)', view: 'David Tshibola (Lecture seule)' }),
  },
  {
    slug: 'ecole', entityCode: 'ECOLE', label: 'École', suffix: 'ecole', incomeMain: 'Frais scolaires', scale: 1.3,
    departments: ['Pédagogie', 'Intendance'],
    people: PEOPLE({ ctrl: 'Esther Banza (Contrôleuse)', dir: 'Joseph Kalala (Direction)', cash: 'Grâce Mwamba (Caissière)', req: 'Sylvie Mukendi (Demandeuse)', view: 'Pascal Numbi (Lecture seule)' }),
  },
];

async function main() {
  const { prisma, platformDb, disconnectAll } = await import('../src/server/db');
  const { runInOrg } = await import('../src/server/tenant');
  const accountsSvc = await import('../src/server/modules/accounts/service');
  const incomesSvc = await import('../src/server/modules/incomes/service');
  const expensesSvc = await import('../src/server/modules/expenses/service');
  const transfersSvc = await import('../src/server/modules/transfers/service');
  const cashSvc = await import('../src/server/modules/cash/service');
  const fxSvc = await import('../src/server/modules/fx/service');
  const frSvc = await import('../src/server/modules/fund-requests/service');
  const budgetSvc = await import('../src/server/modules/budgets/service');
  const recSvc = await import('../src/server/modules/reconciliation/service');
  const attSvc = await import('../src/server/modules/attachments/service');
  const ledger = await import('../src/server/ledger');

  const owner = platformDb();
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  let ok = 0;
  const failures: string[] = [];
  const attempt = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try { const r = await fn(); ok++; return r; } catch (e) { failures.push(`${label} : ${e instanceof Error ? e.message : String(e)}`); return null; }
  };
  const credentials: { email: string; organisation: string; role: string }[] = [];

  for (const cfg of ORGS) {
    const org = await owner.organization.findUnique({ where: { slug: cfg.slug } });
    if (!org) throw new Error(`Organisation « ${cfg.slug} » introuvable : lancez d'abord le seed de base (pnpm db:seed).`);

    await runInOrg(org.id, async () => {
      if (await prisma.setting.findFirst({ where: { key: 'demoSeeded' } })) {
        console.log(`[${cfg.label}] déjà peuplée — ignorée.`);
        return;
      }
      const entity = await prisma.entity.findFirstOrThrow({ where: { code: cfg.entityCode } });
      const S = cfg.scale;

      // --- Utilisateurs --------------------------------------------------------------------------------
      const P: Record<string, Actor> = {};
      for (const p of cfg.people) {
        const email = `${p.local}.${cfg.suffix}@sec.local`;
        const u = await prisma.user.upsert({ where: { email }, update: {}, create: { email, fullName: p.fullName, passwordHash } });
        await prisma.userEntityRole.upsert({
          where: { userId_entityId_role: { userId: u.id, entityId: entity.id, role: p.role } },
          update: {}, create: { userId: u.id, entityId: entity.id, role: p.role },
        });
        P[p.key] = {
          id: u.id, email, fullName: p.fullName, sessionId: `seed-${cfg.slug}-${p.key}`, roles: [{ entityId: entity.id, role: p.role }],
          organizationId: org.id, isPlatformAdmin: false, totpEnabled: true, needsTotpSetup: false, stepUpUntil: new Date(Date.now() + 6 * 3600_000),
        };
        credentials.push({ email, organisation: cfg.label, role: p.role });
      }
      const ctrl = P.ctrl!; const cashier = P.cash!; const requester = P.req!; const director = P.dir!;

      // --- Départements, catégories --------------------------------------------------------------------
      const dep: Record<string, string> = {};
      for (const name of cfg.departments) {
        dep[name] = (await prisma.department.upsert({ where: { entityId_name: { entityId: entity.id, name } }, update: {}, create: { entityId: entity.id, name } })).id;
      }
      const cat = async (kind: 'INCOME' | 'EXPENSE', name: string) =>
        (await prisma.category.findFirstOrThrow({ where: { entityId: entity.id, kind, name } })).id;
      const C = {
        fourn: await cat('EXPENSE', 'Fournitures'), sal: await cat('EXPENSE', 'Salaires'), trans: await cat('EXPENSE', 'Transport'),
        maint: await cat('EXPENSE', 'Maintenance'), autre: await cat('EXPENSE', 'Autres dépenses'),
        main: await cat('INCOME', cfg.incomeMain), autreIn: await cat('INCOME', 'Autres recettes'),
      };

      // --- Comptes (ouverture il y a 125 jours) ---------------------------------------------------------
      const openedAt = dayStr(125);
      const mk = (type: 'CASH' | 'BANK', name: string, currency: Cur, openingBalance: string, extra: Record<string, string> = {}) =>
        accountsSvc.createAccount(ctrl, { entityId: entity.id, type, name, currency, openingBalance, openedAt, ...extra }, META);
      const A = {
        cash: (await mk('CASH', `Caisse principale ${cfg.entityCode}`, 'USD', money(5000 * S))).id,
        cashCdf: (await mk('CASH', `Caisse CDF ${cfg.entityCode}`, 'CDF', money(12_000_000 * S))).id,
        bank: (await mk('BANK', `Rawbank USD — ${cfg.entityCode}`, 'USD', money(40_000 * S), { bankName: 'Rawbank', holderName: cfg.label, accountNumber: `00010-${cfg.entityCode.length}2345-67890-12` })).id,
        bankCdf: (await mk('BANK', `Equity BCDC CDF — ${cfg.entityCode}`, 'CDF', money(80_000_000 * S), { bankName: 'Equity BCDC', holderName: cfg.label, accountNumber: `00022-${cfg.entityCode.length}8765-43210-77` })).id,
      };

      // --- Taux de change (BCC), un par semaine ------------------------------------------------------------
      for (let w = 17; w >= 0; w--) {
        const rate = 2740 + (17 - w) * 5.5 + between(-6, 6);
        await attempt('taux', () => fxSvc.createRate(ctrl, { date: dayStr(w * 7), base: 'USD', quote: 'CDF', rate: rate.toFixed(2), source: 'BCC' }, META));
      }

      // --- Historique d'activité sur ~4 mois, dans l'ordre chronologique -------------------------------------
      type Step = { daysAgo: number; label: string; run: () => Promise<unknown> };
      const plan: Step[] = [];
      const add = (daysAgo: number, label: string, run: () => Promise<unknown>) => { if (daysAgo >= 1 && daysAgo <= 118) plan.push({ daysAgo, label, run }); };
      const inc = (actor: Actor, accountId: string, categoryId: string, source: string, amount: number, cur: Cur, method: 'CASH' | 'BANK_TRANSFER', d: number) =>
        add(d, `recette ${source}`, () => incomesSvc.createIncome(actor, { entityId: entity.id, accountId, categoryId, source, amount: money(amount), currency: cur, paymentMethod: method, date: dayStr(d) }, META));
      const exp = (actor: Actor, accountId: string, categoryId: string, beneficiary: string, purpose: string, amount: number, cur: Cur, method: 'CASH' | 'BANK_TRANSFER', d: number, departmentId?: string) =>
        add(d, `dépense ${beneficiary}`, () => expensesSvc.createExpense(actor, { entityId: entity.id, accountId, categoryId, beneficiary, purpose, amount: money(amount), currency: cur, paymentMethod: method, date: dayStr(d), departmentId }, META));

      const clients = cfg.entityCode === 'SEC' ? ['Mining Solutions Kolwezi', 'Kolwezi Logistics SARL'] : ['Frais scolaires — 1re tranche', 'Frais scolaires — 2e tranche'];
      for (let m = 0; m < 5; m++) {
        const base = m * 30; // m = 0 : mois courant
        inc(ctrl, A.bank, C.main, clients[0]!, round(between(3400, 5800) * S, 50), 'USD', 'BANK_TRANSFER', base + 25);
        inc(ctrl, A.bank, C.main, clients[1]!, round(between(2200, 3800) * S, 50), 'USD', 'BANK_TRANSFER', base + 12);
        for (let w = 0; w < 4; w++) inc(cashier, A.cash, C.autreIn, 'Ventes comptoir', round(between(180, 520), 10), 'USD', 'CASH', base + 3 + w * 7);
        for (let w = 0; w < 3; w++) inc(cashier, A.cashCdf, C.autreIn, 'Encaissements CDF', round(between(900_000, 2_600_000) * S, 10_000), 'CDF', 'CASH', base + 5 + w * 9);
        exp(ctrl, A.bank, C.sal, 'Personnel', 'Salaires du mois', round(6500 * S, 50), 'USD', 'BANK_TRANSFER', base + 2);
        exp(ctrl, A.bank, C.autre, 'Bailleur Immo Katanga', 'Loyer', 1200, 'USD', 'BANK_TRANSFER', base + 27);
        for (let w = 0; w < 4; w++) exp(cashier, A.cash, C.fourn, ['Papeterie Centrale', 'Quincaillerie Lualaba', 'Bureau Plus'][w % 3]!, 'Fournitures', round(between(45, 190), 5), 'USD', 'CASH', base + 4 + w * 7);
        for (let w = 0; w < 3; w++) exp(cashier, A.cash, C.trans, ['Station Total', 'Taxi Kolwezi', 'Station Engen'][w]!, 'Carburant et déplacements', round(between(35, 130), 5), 'USD', 'CASH', base + 6 + w * 9);
        exp(cashier, A.cash, C.maint, 'Atelier Lualaba', 'Entretien', round(between(120, 280), 10), 'USD', 'CASH', base + 15);
        for (let w = 0; w < 3; w++) exp(cashier, A.cashCdf, C.trans, 'Moto-taxis', 'Courses locales', round(between(250_000, 700_000), 10_000), 'CDF', 'CASH', base + 8 + w * 8);
        add(base + 20, 'versement', () => transfersSvc.depositToBank(cashier, { cashAccountId: A.cash, bankAccountId: A.bank, amount: '600.00', description: 'Versement des ventes comptoir', date: dayStr(base + 20) }, META));
        add(base + 18, 'frais bancaires', () => transfersSvc.recordBankFee(ctrl, { bankAccountId: A.bank, amount: money(between(12, 28)), description: 'Frais de tenue de compte', date: dayStr(base + 18) }, META));
      }
      // Cas à signaler : dépense inhabituelle et doublon potentiel.
      exp(ctrl, A.bank, C.maint, 'Groupe Électrogène Katanga', 'Réparation du groupe électrogène', 2350, 'USD', 'BANK_TRANSFER', 9);
      exp(cashier, A.cash, C.trans, 'Station Total', 'Carburant — véhicule de service', 85, 'USD', 'CASH', 6);
      exp(cashier, A.cash, C.trans, 'Station Total', 'Carburant — véhicule de service', 85, 'USD', 'CASH', 4);

      plan.sort((a, b) => b.daysAgo - a.daysAgo);
      for (const step of plan) await attempt(`${cfg.label} J-${step.daysAgo} ${step.label}`, step.run);

      const w1 = await attempt('retrait', () => transfersSvc.initiateWithdrawal(ctrl, { bankAccountId: A.bank, cashAccountId: A.cash, amount: '1500.00', description: 'Réapprovisionnement de la caisse' }, META));
      if (w1) await attempt('confirmation retrait', () => transfersSvc.confirmWithdrawal(cashier, w1.id, META));
      await attempt('retrait en transit', () => transfersSvc.initiateWithdrawal(ctrl, { bankAccountId: A.bank, cashAccountId: A.cash, amount: '700.00', description: 'Retrait pour dépenses courantes' }, META));
      await attempt('virement multidevise', () => transfersSvc.transferBankToBank(ctrl, { fromAccountId: A.bank, toAccountId: A.bankCdf, amount: '2000.00', description: 'Change USD vers CDF', date: dayStr(10), fx: { rate: '2815.00', rateDate: dayStr(10), rateSource: 'BCC' } }, META));

      // --- Demandes de fonds : un exemplaire de chaque statut ---------------------------------------------------
      const d1 = Object.values(dep)[0]; const d2 = Object.values(dep)[1] ?? d1;
      const newReq = (amount: string, purpose: string, departmentId?: string) =>
        frSvc.createFundRequest(requester, { entityId: entity.id, amount, currency: 'USD', purpose, departmentId, submit: true }, META);
      const toApproved = async (amount: string, purpose: string, departmentId?: string) => {
        const r = await newReq(amount, purpose, departmentId);
        await frSvc.reviewFundRequest(ctrl, r.id, META);
        if (Number(amount) > 500) { await frSvc.escalateFundRequest(ctrl, r.id, 'Au-dessus du plafond de la contrôleuse', META); await frSvc.approveFundRequest(director, r.id, undefined, META); }
        else await frSvc.approveFundRequest(ctrl, r.id, 'Conforme au budget', META);
        return r;
      };
      const receipt = (id: string) => attSvc.uploadAttachment(requester, { target: { type: 'fundRequest', id }, kind: 'RECEIPT', fileName: 'facture.png', declaredType: 'image/png', bytes: PNG }, META);
      const disburse = (id: string) => frSvc.disburseFundRequest(cashier, id, { accountId: A.cash }, META);
      const received = async (id: string) => { await disburse(id); await frSvc.confirmReceipt(requester, id, META); };
      const justified = async (id: string) => { await received(id); await receipt(id); await frSvc.justifyFundRequest(requester, id, 'Factures jointes', META); };

      const requests: [string, { id: string } | null, number][] = [];
      const reg = async (label: string, days: number, fn: () => Promise<{ id: string }>) => { const r = await attempt(label, fn); requests.push([label, r, days]); };
      await reg('DF clôturée 1', 95, async () => { const r = await toApproved('120.00', 'Achat de câbles et de petit matériel', d1); await justified(r.id); await frSvc.closeFundRequest(ctrl, r.id, undefined, META); return r; });
      await reg('DF clôturée 2', 70, async () => { const r = await toApproved('350.00', 'Licence logicielle et disque dur externe', d1); await justified(r.id); await frSvc.closeFundRequest(ctrl, r.id, undefined, META); return r; });
      await reg('DF justifiée', 33, async () => { const r = await toApproved('210.00', 'Réparation de la climatisation', d2); await justified(r.id); return r; });
      await reg('DF reçue', 21, async () => { const r = await toApproved('160.00', 'Achat de fournitures pour la mission de terrain', d2); await received(r.id); return r; });
      await reg('DF décaissée', 14, async () => { const r = await toApproved('95.00', 'Frais de transport du personnel'); await disburse(r.id); return r; });
      await reg('DF approuvée', 6, () => toApproved('480.00', 'Achat de deux ordinateurs portables', d1));
      await reg('DF transmise au chef', 4, async () => { const r = await newReq('2500.00', 'Acquisition d’un véhicule utilitaire d’occasion', d2); await frSvc.reviewFundRequest(ctrl, r.id, META); await frSvc.escalateFundRequest(ctrl, r.id, 'Montant supérieur à mon plafond', META); return r; });
      await reg('DF en examen', 3, async () => { const r = await newReq('200.00', 'Impression de documents'); await frSvc.reviewFundRequest(ctrl, r.id, META); return r; });
      await reg('DF soumise', 2, () => newReq('90.00', 'Abonnement internet du mois'));
      await attempt('DF brouillon', () => frSvc.createFundRequest(requester, { entityId: entity.id, amount: '60.00', currency: 'USD', purpose: 'Petit matériel de bureau (brouillon)' }, META));
      await reg('DF rejetée', 40, async () => { const r = await newReq('400.00', 'Achat de mobilier non prévu au budget'); await frSvc.reviewFundRequest(ctrl, r.id, META); await frSvc.rejectFundRequest(ctrl, r.id, 'Non prévu au budget, à reporter au prochain trimestre', META); return r; });
      for (const [, r, d] of requests) if (r) await prisma.fundRequest.update({ where: { id: r.id }, data: { createdAt: new Date(Date.now() - d * DAY) } });

      // --- Budgets ---------------------------------------------------------------------------------------------
      await attempt('budget', () => budgetSvc.createBudget(ctrl, {
        entityId: entity.id, name: `Budget ${cfg.label} — T4 2026`, periodStart: new Date(Date.now() - 45 * DAY).toISOString(), periodEnd: new Date(Date.now() + 50 * DAY).toISOString(), currency: 'USD',
        lines: [{ departmentId: d1!, amount: '1000.00' }, { departmentId: d2!, amount: '6000.00' }, { categoryId: C.fourn, amount: '1200.00' }],
      }, META));

      // --- Clôtures de caisse : jours clos, un écart à valider, des jours volontairement non clos -------------------
      const endOfDay = async (accountId: string, daysAgo: number) =>
        (await ledger.getAccountBalance(prisma, accountId, new Date(`${dayStr(daysAgo)}T23:59:59.999+02:00`))).toFixed(2);
      for (const d of [12, 11, 10]) await attempt(`clôture J-${d}`, async () => cashSvc.closeCashDay(cashier, A.cash, { date: dayStr(d), countedBalance: await endOfDay(A.cash, d) }, META));
      await attempt('clôture avec écart', async () => {
        const theo = Number(await endOfDay(A.cash, 8));
        return cashSvc.closeCashDay(cashier, A.cash, { date: dayStr(8), countedBalance: money(theo - 10), justification: 'Un billet de 10 USD introuvable après recomptage' }, META);
      });

      // --- Relevé bancaire à rapprocher ---------------------------------------------------------------------------
      await attempt('relevé bancaire', async () => {
        const start = new Date(Date.now() - 32 * DAY);
        const end = new Date(Date.now() - 3 * DAY);
        const entries = await prisma.ledgerEntry.findMany({
          where: { accountId: A.bank, tx: { status: 'POSTED', kind: { notIn: ['REVERSAL', 'OPENING_BALANCE'] }, date: { gte: start, lte: end } } },
          include: { tx: { select: { reference: true, date: true, description: true } } }, orderBy: { tx: { date: 'asc' } },
        });
        const opening = await ledger.getAccountBalance(prisma, A.bank, new Date(start.getTime() - 1));
        const usable = entries.slice(0, -1); // la dernière écriture n'apparaît pas sur le relevé
        let debitSeen = 0;
        const rows = usable.map((e, i) => {
          let amount = Number(e.amount.toString());
          if (amount < 0 && ++debitSeen === 3) amount -= 5; // un écart de montant volontaire
          return { date: e.tx.date.toISOString().slice(0, 10), label: e.tx.description.toUpperCase().slice(0, 60), debit: amount < 0 ? money(-amount) : '', credit: amount > 0 ? money(amount) : '', ref: i % 3 === 2 ? '' : e.tx.reference };
        });
        rows.push({ date: end.toISOString().slice(0, 10), label: 'FRAIS DE TENUE DE COMPTE', debit: '15.00', credit: '', ref: '' }); // frais non enregistré
        const cents = (v: string) => Math.round(Number(v) * 100);
        const netCents = rows.reduce((s, r) => s + (r.credit ? cents(r.credit) : 0) - (r.debit ? cents(r.debit) : 0), 0);
        const closing = ((cents(opening.toFixed(2)) + netCents) / 100).toFixed(2);
        const csv = ['date;libellé;débit;crédit;référence', ...rows.map((r) => [r.date, r.label, r.debit, r.credit, r.ref].join(';'))].join('\n');
        const imp = await recSvc.importStatement(ctrl, {
          accountId: A.bank, fileName: `releve-rawbank-${cfg.suffix}.csv`, bytes: Buffer.from(csv, 'utf8'),
          mapping: { hasHeader: true, date: 0, label: 1, debit: 2, credit: 3, reference: 4 }, openingBalance: opening.toFixed(2), closingBalance: closing,
          periodStart: start.toISOString(), periodEnd: end.toISOString(),
        }, META);
        await recSvc.autoMatch(ctrl, imp.id, META);
        const st = await recSvc.getStatement(ctrl, imp.id);
        for (const l of st.columns.matched.filter((x) => x.preselectedEntryId).slice(0, 4)) await recSvc.confirmLine(ctrl, imp.id, l.id, undefined, META);
      });

      await prisma.setting.create({ data: { key: 'demoSeeded', value: new Date().toISOString() } });
      console.log(`[${cfg.label}] peuplée.`);
    });
  }

  console.log(`\nDonnées de démonstration : ${ok} opérations réussies, ${failures.length} ignorée(s).`);
  if (failures.length) console.log(failures.map((f) => `  - ${f}`).join('\n'));
  if (credentials.length) {
    console.log(`\nComptes de démonstration (mot de passe commun : ${DEMO_PASSWORD})`);
    console.table(credentials);
  }
  await disconnectAll();
}

main().catch((e) => { console.error(e); process.exit(1); });
