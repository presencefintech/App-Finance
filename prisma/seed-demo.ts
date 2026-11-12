/**
 * Données de démonstration SEC Finance Control.
 *
 * Passe par les VRAIS services (grand livre, circuit d'approbation, avances, budgets, rapprochement) :
 * soldes, graphiques et audit sont donc cohérents. Rejouable sans risque (marqueur « demoSeeded »).
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
let seedState = 20261112;
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

async function main() {
  const { prisma } = await import('../src/server/db');
  const accountsSvc = await import('../src/server/modules/accounts/service');
  const incomesSvc = await import('../src/server/modules/incomes/service');
  const expensesSvc = await import('../src/server/modules/expenses/service');
  const transfersSvc = await import('../src/server/modules/transfers/service');
  const cashSvc = await import('../src/server/modules/cash/service');
  const fxSvc = await import('../src/server/modules/fx/service');
  const frSvc = await import('../src/server/modules/fund-requests/service');
  const advSvc = await import('../src/server/modules/advances/service');
  const budgetSvc = await import('../src/server/modules/budgets/service');
  const recSvc = await import('../src/server/modules/reconciliation/service');
  const attSvc = await import('../src/server/modules/attachments/service');
  const ledger = await import('../src/server/ledger');
  type Role = import('../src/generated/prisma/enums').Role;
  type Actor = import('../src/server/auth').CurrentUser;

  if (await prisma.setting.findUnique({ where: { key: 'demoSeeded' } })) {
    console.log('Données de démonstration déjà présentes (marqueur demoSeeded) — rien à faire.');
    await prisma.$disconnect();
    return;
  }

  let ok = 0;
  const failures: string[] = [];
  /** Une opération qui échoue (règle métier) est journalisée sans interrompre le jeu de données. */
  const attempt = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try { const r = await fn(); ok++; return r; } catch (e) { failures.push(`${label} : ${e instanceof Error ? e.message : String(e)}`); return null; }
  };

  // --- Entités, catégories, départements -----------------------------------------------------
  const sec = await prisma.entity.upsert({ where: { code: 'SEC' }, update: {}, create: { code: 'SEC', name: 'SEC SARL' } });
  const eco = await prisma.entity.upsert({ where: { code: 'ECOLE' }, update: {}, create: { code: 'ECOLE', name: 'École' } });
  const CAT_IN = ['Frais scolaires', 'Partenaires', 'Autres recettes'];
  const CAT_OUT = ['Fournitures', 'Salaires', 'Transport', 'Maintenance', 'Frais bancaires', 'Demandes de fonds', 'Autres dépenses'];
  for (const entityId of [sec.id, eco.id]) {
    for (const name of CAT_IN) await prisma.category.upsert({ where: { entityId_kind_name: { entityId, kind: 'INCOME', name } }, update: {}, create: { entityId, kind: 'INCOME', name } });
    for (const name of CAT_OUT) await prisma.category.upsert({ where: { entityId_kind_name: { entityId, kind: 'EXPENSE', name } }, update: {}, create: { entityId, kind: 'EXPENSE', name } });
  }
  const cat = async (entityId: string, kind: 'INCOME' | 'EXPENSE', name: string) =>
    (await prisma.category.findUniqueOrThrow({ where: { entityId_kind_name: { entityId, kind, name } } })).id;
  const dep = async (entityId: string, name: string) =>
    (await prisma.department.upsert({ where: { entityId_name: { entityId, name } }, update: {}, create: { entityId, name } })).id;
  const depInfo = await dep(sec.id, 'Informatique');
  const depLog = await dep(sec.id, 'Logistique');
  await dep(sec.id, 'Administration');
  const depPeda = await dep(eco.id, 'Pédagogie');
  await dep(eco.id, 'Intendance');

  // --- Utilisateurs de démonstration -----------------------------------------------------------
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  const people: Record<string, Actor> = {};
  const person = async (key: string, email: string, fullName: string, roles: { entityId: string; role: Role }[]) => {
    const u = await prisma.user.upsert({ where: { email }, update: {}, create: { email, fullName, passwordHash } });
    for (const r of roles) await prisma.userEntityRole.upsert({ where: { userId_entityId_role: { userId: u.id, entityId: r.entityId, role: r.role } }, update: {}, create: { userId: u.id, ...r } });
    people[key] = {
      id: u.id, email, fullName, sessionId: `seed-${key}`, roles, totpEnabled: true, needsTotpSetup: false,
      stepUpUntil: new Date(Date.now() + 6 * 3600_000),
    };
  };
  const both = (role: Role) => [{ entityId: sec.id, role }, { entityId: eco.id, role }];
  await person('controleuse', 'controleuse@sec.local', 'Marie Kabongo (Contrôleuse)', both('CONTROLLER'));
  await person('directeur', 'directeur@sec.local', 'Jean-Paul Mutombo (Direction)', both('DIRECTOR'));
  await person('caissier', 'caissier@sec.local', 'Patrick Ilunga (Caissier SEC + École)', both('CASHIER'));
  await person('caissierEcole', 'caissier.ecole@sec.local', 'Grâce Mwamba (Caissière École)', [{ entityId: eco.id, role: 'CASHIER' }]);
  await person('demandeur', 'demandeur@sec.local', 'Alain Kasongo (Demandeur SEC)', [{ entityId: sec.id, role: 'REQUESTER' }]);
  await person('demandeurEcole', 'demandeur.ecole@sec.local', 'Sylvie Banza (Demandeuse École)', [{ entityId: eco.id, role: 'REQUESTER' }]);
  await person('lecteur', 'lecteur@sec.local', 'David Tshibola (Lecture seule)', both('VIEWER'));
  const P = people as Record<string, Actor>;
  const ctrl = P.controleuse!;

  // --- Comptes (ouverture il y a 125 jours) ------------------------------------------------------
  const openedAt = dayStr(125);
  const mk = (entityId: string, type: 'CASH' | 'BANK', name: string, currency: 'USD' | 'CDF', openingBalance: string, extra: Record<string, string> = {}) =>
    accountsSvc.createAccount(ctrl, { entityId, type, name, currency, openingBalance, openedAt, ...extra }, META);
  const A = {
    secCash: (await mk(sec.id, 'CASH', 'Caisse principale SEC', 'USD', '5000.00')).id,
    secCashCdf: (await mk(sec.id, 'CASH', 'Caisse CDF SEC', 'CDF', '12000000.00')).id,
    secBank: (await mk(sec.id, 'BANK', 'Rawbank USD — SEC', 'USD', '40000.00', { bankName: 'Rawbank', holderName: 'SEC SARL', accountNumber: '00010-12345-67890-12' })).id,
    secBankCdf: (await mk(sec.id, 'BANK', 'Equity BCDC CDF — SEC', 'CDF', '80000000.00', { bankName: 'Equity BCDC', holderName: 'SEC SARL', accountNumber: '00022-98765-43210-77' })).id,
    ecoCash: (await mk(eco.id, 'CASH', 'Caisse École USD', 'USD', '2500.00')).id,
    ecoCashCdf: (await mk(eco.id, 'CASH', 'Caisse École CDF', 'CDF', '8000000.00')).id,
    ecoBank: (await mk(eco.id, 'BANK', 'Rawbank USD — École', 'USD', '15000.00', { bankName: 'Rawbank', holderName: 'École', accountNumber: '00010-55555-11111-34' })).id,
  };

  // --- Taux de change (BCC), un par semaine ---------------------------------------------------------
  for (let w = 17; w >= 0; w--) {
    const rate = 2740 + (17 - w) * 5.5 + between(-6, 6);
    await attempt('taux', () => fxSvc.createRate(ctrl, { date: dayStr(w * 7), base: 'USD', quote: 'CDF', rate: rate.toFixed(2), source: 'BCC' }, META));
  }

  // --- Historique d'activité sur ~4 mois, dans l'ordre chronologique ------------------------------------
  const catSec = { fourn: await cat(sec.id, 'EXPENSE', 'Fournitures'), sal: await cat(sec.id, 'EXPENSE', 'Salaires'), trans: await cat(sec.id, 'EXPENSE', 'Transport'), maint: await cat(sec.id, 'EXPENSE', 'Maintenance'), autre: await cat(sec.id, 'EXPENSE', 'Autres dépenses'), part: await cat(sec.id, 'INCOME', 'Partenaires'), autreIn: await cat(sec.id, 'INCOME', 'Autres recettes') };
  const catEco = { fourn: await cat(eco.id, 'EXPENSE', 'Fournitures'), sal: await cat(eco.id, 'EXPENSE', 'Salaires'), maint: await cat(eco.id, 'EXPENSE', 'Maintenance'), autre: await cat(eco.id, 'EXPENSE', 'Autres dépenses'), frais: await cat(eco.id, 'INCOME', 'Frais scolaires'), autreIn: await cat(eco.id, 'INCOME', 'Autres recettes') };

  type Step = { daysAgo: number; label: string; run: () => Promise<unknown> };
  const plan: Step[] = [];
  const add = (daysAgo: number, label: string, run: () => Promise<unknown>) => { if (daysAgo >= 1 && daysAgo <= 118) plan.push({ daysAgo, label, run }); };
  const inc = (entityId: string, actor: Actor, accountId: string, categoryId: string, source: string, amount: number, cur: 'USD' | 'CDF', method: 'CASH' | 'BANK_TRANSFER', d: number) =>
    add(d, `recette ${source}`, () => incomesSvc.createIncome(actor, { entityId, accountId, categoryId, source, amount: money(amount), currency: cur, paymentMethod: method, date: dayStr(d) }, META));
  const exp = (entityId: string, actor: Actor, accountId: string, categoryId: string, beneficiary: string, purpose: string, amount: number, cur: 'USD' | 'CDF', method: 'CASH' | 'BANK_TRANSFER', d: number, departmentId?: string) =>
    add(d, `dépense ${beneficiary}`, () => expensesSvc.createExpense(actor, { entityId, accountId, categoryId, beneficiary, purpose, amount: money(amount), currency: cur, paymentMethod: method, date: dayStr(d), departmentId }, META));

  const cashier = P.caissier!;
  for (let m = 0; m < 5; m++) {
    const base = m * 30; // m = 0 : mois courant
    // SEC — recettes
    inc(sec.id, ctrl, A.secBank, catSec.part, 'Mining Solutions Kolwezi', round(between(3400, 5800), 50), 'USD', 'BANK_TRANSFER', base + 25);
    inc(sec.id, ctrl, A.secBank, catSec.part, 'Kolwezi Logistics SARL', round(between(2200, 3800), 50), 'USD', 'BANK_TRANSFER', base + 12);
    for (let w = 0; w < 4; w++) inc(sec.id, cashier, A.secCash, catSec.autreIn, 'Ventes comptoir', round(between(180, 520), 10), 'USD', 'CASH', base + 3 + w * 7);
    for (let w = 0; w < 3; w++) inc(sec.id, cashier, A.secCashCdf, catSec.autreIn, 'Ventes comptoir CDF', round(between(900000, 2600000), 10000), 'CDF', 'CASH', base + 5 + w * 9);
    // SEC — dépenses
    exp(sec.id, ctrl, A.secBank, catSec.sal, 'Personnel SEC', 'Salaires du mois', 6500, 'USD', 'BANK_TRANSFER', base + 2);
    exp(sec.id, ctrl, A.secBank, catSec.autre, 'Bailleur Immo Katanga', 'Loyer des bureaux', 1200, 'USD', 'BANK_TRANSFER', base + 27);
    for (let w = 0; w < 4; w++) exp(sec.id, cashier, A.secCash, catSec.fourn, ['Papeterie Centrale', 'Quincaillerie Lualaba', 'Bureau Plus'][w % 3]!, 'Fournitures de bureau', round(between(45, 190), 5), 'USD', 'CASH', base + 4 + w * 7);
    for (let w = 0; w < 3; w++) exp(sec.id, cashier, A.secCash, catSec.trans, ['Station Total', 'Taxi Kolwezi', 'Station Engen'][w]!, 'Carburant et déplacements', round(between(35, 130), 5), 'USD', 'CASH', base + 6 + w * 9);
    exp(sec.id, cashier, A.secCash, catSec.maint, 'Atelier Mécanique Lualaba', 'Entretien du matériel', round(between(120, 280), 10), 'USD', 'CASH', base + 15);
    for (let w = 0; w < 3; w++) exp(sec.id, cashier, A.secCashCdf, catSec.trans, 'Moto-taxis', 'Courses locales', round(between(250000, 700000), 10000), 'CDF', 'CASH', base + 8 + w * 8);
    // École — recettes
    inc(eco.id, ctrl, A.ecoBank, catEco.frais, 'Frais scolaires — 1re tranche', round(between(6800, 8400), 50), 'USD', 'BANK_TRANSFER', base + 24);
    inc(eco.id, ctrl, A.ecoBank, catEco.frais, 'Frais scolaires — 2e tranche', round(between(4800, 6300), 50), 'USD', 'BANK_TRANSFER', base + 10);
    for (let w = 0; w < 4; w++) inc(eco.id, P.caissierEcole!, A.ecoCashCdf, catEco.frais, 'Frais scolaires encaissés (CDF)', round(between(12000000, 22000000), 100000), 'CDF', 'CASH', base + 2 + w * 7);
    for (let w = 0; w < 2; w++) inc(eco.id, P.caissierEcole!, A.ecoCash, catEco.autreIn, 'Inscriptions et divers', round(between(250, 700), 10), 'USD', 'CASH', base + 6 + w * 11);
    // École — dépenses
    exp(eco.id, ctrl, A.ecoBank, catEco.sal, 'Enseignants', 'Salaires du corps enseignant', 7600, 'USD', 'BANK_TRANSFER', base + 1);
    for (let w = 0; w < 3; w++) exp(eco.id, P.caissierEcole!, A.ecoCash, catEco.fourn, ['Librairie Savoir', 'Papeterie Scolaire', 'Fournitures Lualaba'][w]!, 'Matériel pédagogique', round(between(70, 230), 5), 'USD', 'CASH', base + 5 + w * 9);
    exp(eco.id, P.caissierEcole!, A.ecoCash, catEco.maint, 'Entreprise Bâti-Kolwezi', 'Réparation des salles', round(between(150, 320), 10), 'USD', 'CASH', base + 13);
    for (let w = 0; w < 3; w++) exp(eco.id, P.caissierEcole!, A.ecoCashCdf, catEco.autre, 'Divers école', 'Menues dépenses', round(between(2500000, 5500000), 100000), 'CDF', 'CASH', base + 4 + w * 8);
    // Transferts (jamais des recettes ni des dépenses) et frais bancaires
    add(base + 20, 'versement SEC', async () => transfersSvc.depositToBank(cashier, { cashAccountId: A.secCash, bankAccountId: A.secBank, amount: '600.00', description: 'Versement des ventes comptoir', date: dayStr(base + 20) }, META));
    add(base + 14, 'versement École', async () => transfersSvc.depositToBank(P.caissierEcole!, { cashAccountId: A.ecoCash, bankAccountId: A.ecoBank, amount: '400.00', description: 'Versement des inscriptions', date: dayStr(base + 14) }, META));
    add(base + 18, 'frais bancaires SEC', () => transfersSvc.recordBankFee(ctrl, { bankAccountId: A.secBank, amount: money(between(12, 28)), description: 'Frais de tenue de compte', date: dayStr(base + 18) }, META));
    add(base + 17, 'frais bancaires École', () => transfersSvc.recordBankFee(ctrl, { bankAccountId: A.ecoBank, amount: money(between(10, 22)), description: 'Frais de tenue de compte', date: dayStr(base + 17) }, META));
  }
  // Cas à signaler : dépense inhabituelle et doublon potentiel (alimentent les alertes et le rapport hebdomadaire).
  exp(sec.id, ctrl, A.secBank, catSec.maint, 'Groupe Électrogène Katanga', 'Réparation du groupe électrogène', 2350, 'USD', 'BANK_TRANSFER', 9);
  exp(sec.id, cashier, A.secCash, catSec.trans, 'Station Total', 'Carburant — véhicule de service', 85, 'USD', 'CASH', 6);
  exp(sec.id, cashier, A.secCash, catSec.trans, 'Station Total', 'Carburant — véhicule de service', 85, 'USD', 'CASH', 4);

  plan.sort((a, b) => b.daysAgo - a.daysAgo); // du plus ancien au plus récent
  for (const step of plan) await attempt(`J-${step.daysAgo} ${step.label}`, step.run);

  // Retraits bancaires en deux temps + virement multidevise (taux enregistré).
  const w1 = await attempt('retrait', () => transfersSvc.initiateWithdrawal(ctrl, { bankAccountId: A.secBank, cashAccountId: A.secCash, amount: '1500.00', description: 'Réapprovisionnement de la caisse' }, META));
  if (w1) await attempt('confirmation retrait', () => transfersSvc.confirmWithdrawal(cashier, w1.id, META));
  await attempt('retrait en transit', () => transfersSvc.initiateWithdrawal(ctrl, { bankAccountId: A.ecoBank, cashAccountId: A.ecoCash, amount: '900.00', description: 'Retrait pour dépenses courantes' }, META));
  await attempt('virement multidevise', () => transfersSvc.transferBankToBank(ctrl, { fromAccountId: A.secBank, toAccountId: A.secBankCdf, amount: '2000.00', description: 'Change USD vers CDF', date: dayStr(10), fx: { rate: '2815.00', rateDate: dayStr(10), rateSource: 'BCC' } }, META));

  // --- Demandes de fonds : un exemplaire de chaque statut ---------------------------------------------------
  const demandeur = P.demandeur!;
  const dir = P.directeur!;
  const newReq = (actor: Actor, entityId: string, amount: string, purpose: string, departmentId?: string) =>
    frSvc.createFundRequest(actor, { entityId, amount, currency: 'USD', purpose, departmentId, submit: true }, META);
  const toApproved = async (actor: Actor, entityId: string, amount: string, purpose: string, departmentId?: string) => {
    const r = await newReq(actor, entityId, amount, purpose, departmentId);
    await frSvc.reviewFundRequest(ctrl, r.id, META);
    if (Number(amount) > 500) { await frSvc.escalateFundRequest(ctrl, r.id, 'Au-dessus du plafond de la contrôleuse', META); await frSvc.approveFundRequest(dir, r.id, undefined, META); }
    else await frSvc.approveFundRequest(ctrl, r.id, 'Conforme au budget', META);
    return r;
  };
  const fakeReceipt = (actor: Actor, id: string) => attSvc.uploadAttachment(actor, { target: { type: 'fundRequest', id }, kind: 'RECEIPT', fileName: 'facture.png', declaredType: 'image/png', bytes: PNG }, META);
  const throughReceipt = async (id: string) => { await frSvc.disburseFundRequest(cashier, id, { accountId: A.secCash }, META); await frSvc.confirmReceipt(demandeur, id, META); };

  const r1 = await attempt('DF clôturée 1', async () => { const r = await toApproved(demandeur, sec.id, '120.00', 'Achat de câbles et de matériel réseau', depInfo); await throughReceipt(r.id); await fakeReceipt(demandeur, r.id); await frSvc.justifyFundRequest(demandeur, r.id, 'Factures jointes', META); await frSvc.closeFundRequest(ctrl, r.id, undefined, META); return r; });
  const r2 = await attempt('DF clôturée 2', async () => { const r = await toApproved(demandeur, sec.id, '350.00', 'Licence logicielle et disque dur externe', depInfo); await throughReceipt(r.id); await fakeReceipt(demandeur, r.id); await frSvc.justifyFundRequest(demandeur, r.id, undefined, META); await frSvc.closeFundRequest(ctrl, r.id, undefined, META); return r; });
  const r3 = await attempt('DF justifiée', async () => { const r = await toApproved(demandeur, sec.id, '210.00', 'Réparation de la climatisation', depLog); await throughReceipt(r.id); await fakeReceipt(demandeur, r.id); await frSvc.justifyFundRequest(demandeur, r.id, undefined, META); return r; });
  const r4 = await attempt('DF reçue', async () => { const r = await toApproved(demandeur, sec.id, '160.00', 'Achat de fournitures pour la mission de terrain', depLog); await throughReceipt(r.id); return r; });
  const r5 = await attempt('DF décaissée', async () => { const r = await toApproved(demandeur, sec.id, '95.00', 'Frais de transport du personnel'); await frSvc.disburseFundRequest(cashier, r.id, { accountId: A.secCash }, META); return r; });
  const r6 = await attempt('DF approuvée', () => toApproved(demandeur, sec.id, '480.00', 'Achat de deux ordinateurs portables', depInfo));
  const r7 = await attempt('DF transmise au chef', async () => { const r = await newReq(demandeur, sec.id, '2500.00', 'Acquisition d’un véhicule utilitaire d’occasion', depLog); await frSvc.reviewFundRequest(ctrl, r.id, META); await frSvc.escalateFundRequest(ctrl, r.id, 'Montant supérieur à mon plafond', META); return r; });
  const r8 = await attempt('DF en examen', async () => { const r = await newReq(demandeur, sec.id, '200.00', 'Impression de documents commerciaux'); await frSvc.reviewFundRequest(ctrl, r.id, META); return r; });
  const r9 = await attempt('DF soumise', () => newReq(demandeur, sec.id, '90.00', 'Abonnement internet du mois'));
  await attempt('DF brouillon', () => frSvc.createFundRequest(demandeur, { entityId: sec.id, amount: '60.00', currency: 'USD', purpose: 'Petit matériel de bureau (brouillon)' }, META));
  const r11 = await attempt('DF rejetée', async () => { const r = await newReq(demandeur, sec.id, '400.00', 'Achat de mobilier non prévu au budget'); await frSvc.reviewFundRequest(ctrl, r.id, META); await frSvc.rejectFundRequest(ctrl, r.id, 'Non prévu au budget, à reporter au prochain trimestre', META); return r; });
  // École
  const ecoCashierActor = P.caissierEcole!;
  const eco1 = await attempt('DF École clôturée', async () => { const r = await toApproved(P.demandeurEcole!, eco.id, '150.00', 'Achat de craies et de cahiers', depPeda); await frSvc.disburseFundRequest(ecoCashierActor, r.id, { accountId: A.ecoCash }, META); await frSvc.confirmReceipt(P.demandeurEcole!, r.id, META); await fakeReceipt(P.demandeurEcole!, r.id); await frSvc.justifyFundRequest(P.demandeurEcole!, r.id, undefined, META); await frSvc.closeFundRequest(ctrl, r.id, undefined, META); return r; });
  const eco2 = await attempt('DF École approuvée', () => toApproved(P.demandeurEcole!, eco.id, '220.00', 'Réparation du matériel de laboratoire', depPeda));
  const eco3 = await attempt('DF École soumise', () => newReq(P.demandeurEcole!, eco.id, '75.00', 'Photocopies des examens du trimestre', depPeda));

  // Avance inter-entités : SEC demande 1 800 USD, l'École avance (créance / dette), remboursement partiel.
  const advReq = await attempt('DF avance', () => toApproved(demandeur, sec.id, '1800.00', 'Avance sur salaires de la mission Likasi', depLog));
  if (advReq) {
    await attempt('décaissement en avance', () => frSvc.disburseFundRequest(cashier, advReq.id, { accountId: A.ecoBank, confirmAdvance: true }, META));
    const adv = (await prisma.interEntityAdvance.findFirst({ where: { fundRequestId: advReq.id } }));
    if (adv) await attempt('remboursement partiel', () => advSvc.repayAdvance(ctrl, adv.id, { fromAccountId: A.secBank, toAccountId: A.ecoBank, amount: '600.00' }, META));
  }
  // Avance ancienne (> 30 jours) pour déclencher l'alerte.
  await attempt('avance manuelle ancienne', () => advSvc.createManualAdvance(ctrl, { lenderAccountId: A.ecoCash, borrowerEntityId: sec.id, amount: '350.00', beneficiary: 'Garage Kolwezi Auto', purpose: 'Réparation du véhicule de SEC payée par l’École', date: dayStr(46) }, META));

  // Étale la date de création des demandes pour les statistiques mensuelles.
  const spread: [{ id: string } | null, number][] = [[r1, 95], [r2, 70], [r3, 33], [r4, 21], [r5, 14], [r6, 6], [r7, 4], [r8, 3], [r9, 2], [r11, 40], [eco1, 55], [eco2, 8], [eco3, 2]];
  for (const [r, d] of spread) if (r) await prisma.fundRequest.update({ where: { id: r.id }, data: { createdAt: new Date(Date.now() - d * DAY) } });

  // --- Budgets ---------------------------------------------------------------------------------------------
  await attempt('budget SEC', () => budgetSvc.createBudget(ctrl, {
    entityId: sec.id, name: 'Budget SEC — T4 2026', periodStart: new Date(Date.now() - 45 * DAY).toISOString(), periodEnd: new Date(Date.now() + 50 * DAY).toISOString(), currency: 'USD',
    lines: [{ departmentId: depInfo, amount: '1000.00' }, { departmentId: depLog, amount: '6000.00' }, { categoryId: catSec.fourn, amount: '1200.00' }],
  }, META));
  await attempt('budget École', () => budgetSvc.createBudget(ctrl, {
    entityId: eco.id, name: 'Budget pédagogique — 1er semestre', periodStart: new Date(Date.now() - 60 * DAY).toISOString(), periodEnd: new Date(Date.now() + 60 * DAY).toISOString(), currency: 'USD',
    lines: [{ departmentId: depPeda, amount: '900.00' }, { categoryId: catEco.fourn, amount: '1500.00' }],
  }, META));

  // --- Clôtures de caisse : quelques jours clos, un écart à valider, des jours volontairement non clos ----------
  // Fin de journée locale (Africa/Lubumbashi) : même borne que celle utilisée par le service de clôture.
  const balanceAtEndOfDay = async (accountId: string, daysAgo: number) =>
    (await ledger.getAccountBalance(prisma, accountId, new Date(`${dayStr(daysAgo)}T23:59:59.999+02:00`))).toFixed(2);
  for (const d of [12, 11, 10]) await attempt(`clôture SEC J-${d}`, async () => cashSvc.closeCashDay(cashier, A.secCash, { date: dayStr(d), countedBalance: await balanceAtEndOfDay(A.secCash, d) }, META));
  await attempt('clôture avec écart', async () => {
    const theo = Number(await balanceAtEndOfDay(A.secCash, 8));
    return cashSvc.closeCashDay(cashier, A.secCash, { date: dayStr(8), countedBalance: money(theo - 10), justification: 'Un billet de 10 USD introuvable après recomptage' }, META);
  });
  await attempt('clôture École J-9', async () => cashSvc.closeCashDay(ecoCashierActor, A.ecoCash, { date: dayStr(9), countedBalance: await balanceAtEndOfDay(A.ecoCash, 9) }, META));

  // --- Relevé bancaire à rapprocher (Rawbank SEC) ----------------------------------------------------------------
  await attempt('relevé bancaire', async () => {
    const start = new Date(Date.now() - 32 * DAY);
    const end = new Date(Date.now() - 3 * DAY);
    const entries = await prisma.ledgerEntry.findMany({
      where: { accountId: A.secBank, tx: { status: 'POSTED', kind: { notIn: ['REVERSAL', 'OPENING_BALANCE'] }, date: { gte: start, lte: end } } },
      include: { tx: { select: { reference: true, date: true, description: true } } }, orderBy: { tx: { date: 'asc' } },
    });
    const opening = await ledger.getAccountBalance(prisma, A.secBank, new Date(start.getTime() - 1));
    const usable = entries.slice(0, -1); // la dernière écriture n'apparaît pas sur le relevé : « absente du relevé »
    let debitSeen = 0;
    const rows: { date: string; label: string; debit: string; credit: string; ref: string }[] = usable.map((e, i) => {
      let amount = Number(e.amount.toString());
      if (amount < 0 && ++debitSeen === 3) amount -= 5; // un écart de montant volontaire
      return {
        date: e.tx.date.toISOString().slice(0, 10), label: e.tx.description.toUpperCase().slice(0, 60),
        debit: amount < 0 ? money(-amount) : '', credit: amount > 0 ? money(amount) : '', ref: i % 3 === 2 ? '' : e.tx.reference,
      };
    });
    rows.push({ date: end.toISOString().slice(0, 10), label: 'FRAIS DE TENUE DE COMPTE', debit: '15.00', credit: '', ref: '' }); // frais non enregistré
    // Somme en centimes entiers : aucun écart d'arrondi flottant entre ouverture, mouvements et clôture.
    const cents = (v: string) => Math.round(Number(v) * 100);
    const netCents = rows.reduce((s, r) => s + (r.credit ? cents(r.credit) : 0) - (r.debit ? cents(r.debit) : 0), 0);
    const closing = ((cents(opening.toFixed(2)) + netCents) / 100).toFixed(2);
    const csv = ['date;libellé;débit;crédit;référence', ...rows.map((r) => [r.date, r.label, r.debit, r.credit, r.ref].join(';'))].join('\n');
    const imp = await recSvc.importStatement(ctrl, {
      accountId: A.secBank, fileName: 'releve-rawbank-usd.csv', bytes: Buffer.from(csv, 'utf8'),
      mapping: { hasHeader: true, date: 0, label: 1, debit: 2, credit: 3, reference: 4 }, openingBalance: opening.toFixed(2), closingBalance: closing,
      periodStart: start.toISOString(), periodEnd: end.toISOString(),
    }, META);
    await recSvc.autoMatch(ctrl, imp.id, META);
    const st = await recSvc.getStatement(ctrl, imp.id);
    for (const l of st.columns.matched.filter((x) => x.preselectedEntryId).slice(0, 4)) await recSvc.confirmLine(ctrl, imp.id, l.id, undefined, META);
  });

  await prisma.setting.create({ data: { key: 'demoSeeded', value: new Date().toISOString() } });

  console.log(`\nDonnées de démonstration créées : ${ok} opérations réussies, ${failures.length} ignorée(s).`);
  if (failures.length) console.log(failures.map((f) => `  - ${f}`).join('\n'));
  console.log(`\nComptes de démonstration (mot de passe commun : ${DEMO_PASSWORD})`);
  console.table([
    ['controleuse@sec.local', 'Contrôleuse financière — SEC + École', '2FA requise'],
    ['directeur@sec.local', 'Direction — SEC + École', '2FA requise'],
    ['caissier@sec.local', 'Caissier — SEC + École (peut décaisser en avance)', '2FA requise'],
    ['caissier.ecole@sec.local', 'Caissière — École', '2FA requise'],
    ['demandeur@sec.local', 'Demandeur — SEC', 'sans 2FA'],
    ['demandeur.ecole@sec.local', 'Demandeur — École', 'sans 2FA'],
    ['lecteur@sec.local', 'Lecture seule — SEC + École', 'sans 2FA'],
  ].map(([email, role, mfa]) => ({ email, role, mfa })));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
