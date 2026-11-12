# SEC Finance Control — Spécification technique pour l'implémentation

> Source : proposition « SEC FINANCE CONTROL » (cahier des charges fonctionnel). Ce document la traduit en architecture, modèle de données, API, écrans et plan de développement.
> Stack : Next.js (interface **et** API via Route Handlers) · PostgreSQL + Prisma · hébergement Railway.
> Note : la proposition commerciale mentionnait un backend Express séparé ; il est remplacé par les Route Handlers Next.js (une seule application à déployer et maintenir).

## Sommaire

1. Contexte et périmètre
2. Architecture et déploiement Railway
3. Rôles et permissions
4. Modèle de données (Prisma)
5. Moteur de grand livre (soldes)
6. Modules métier
7. Registres papier et documents PDF
8. Rapports et tableau de bord
9. Sécurité et contrôle interne
10. API REST — liste des endpoints
11. Écrans Next.js
12. Plan de développement par phases (critères d'acceptation)
13. Questions ouvertes à valider avec le client

---

## 1. Contexte et périmètre

Deux **entités financières indépendantes** : `SEC` (SEC SARL) et `ECOLE` (établissement scolaire). Chacune a ses caisses, comptes bancaires, recettes, dépenses, budgets et historique. Une **contrôleuse financière** (l'assistante) supervise les deux et produit les rapports pour la **direction** (chef hiérarchique).

**Dans le périmètre** : demandes de fonds et circuit d'approbation, recettes, dépenses, caisses, banques multi-comptes, USD/CDF, avances et remboursements inter-entités, budgets et engagements, rapprochement bancaire, registres imprimables, rapports journaliers/hebdo/mensuels (PDF + Excel), audit et sécurité.

**Hors périmètre** : gestion des élèves et paiements individuels (restent dans **PresenceFintech**). SEC Finance Control reçoit au plus des **totaux consolidés** de recettes scolaires (saisie manuelle ou import CSV ; pas d'intégration API en v1). Pas d'intégration bancaire directe en v1 (relevés importés en fichier).

## 2. Architecture et déploiement Railway

### 2.1 Services

```
                 Internet
                    │ HTTPS
       ┌────────────▼─────────────┐
       │      app (Next.js)       │  domaine public : finance.<domaine>
       │  pages  (src/app/(app))  │
       │  API    (src/app/api/v1) │──► src/server/* (services, ledger, auth)
       └──────┬──────────────┬────┘
              │ réseau privé │
     ┌────────▼──┐   ┌───────▼──────────────┐
     │ postgres  │   │ stockage fichiers S3 │  (justificatifs, relevés, PDF)
     └───────────┘   └──────────────────────┘
      (plus tard : redis + service worker pour les rapports lourds)
```

- **Une seule application Next.js** sert les pages et l'API REST (`/api/v1/...`). Interface et API sur le même domaine : cookies de session first-party, pas de CORS.
- Connexion à Postgres via le **réseau privé Railway** (`DATABASE_URL` interne), pas l'URL publique.
- Les Route Handlers tournent en runtime Node.js (Prisma, argon2, pdfkit ne fonctionnent pas en edge).

### 2.2 Variables d'environnement (service `app`)

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (référence Railway, réseau privé) |
| `PORT` | fourni par Railway ; démarrer avec `HOSTNAME=0.0.0.0` |
| `SESSION_SECRET`, `ENCRYPTION_KEY` | secrets générés (32+ octets) — `ENCRYPTION_KEY` chiffre les secrets TOTP et numéros de compte |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` | stockage objet compatible S3 (bucket Railway si disponible sur le compte, sinon Cloudflare R2) |
| `APP_TIMEZONE` | `Africa/Lubumbashi` |
| `APP_URL` | URL publique (vérification de l'en-tête `Origin` contre le CSRF) |

### 2.3 Build et déploiement

- `next.config.ts` : `output: 'standalone'`, `serverExternalPackages: ['argon2', 'pdfkit', 'exceljs']`.
- Build : `pnpm prisma generate && pnpm build` ; start : `node .next/standalone/server.js` (copier `.next/static` et `public` dans le standalone au build), ou `next start`.
- **Pre-deploy command** Railway : `pnpm prisma migrate deploy` (jamais `migrate dev` en prod).
- Healthcheck : `GET /api/v1/health` (vérifie la connexion DB).
- Limite de taille des uploads : vérifiée dans le Route Handler (10 Mo) ; lire le fichier via `request.formData()`.
- Sauvegardes : activer les backups du volume Postgres sur Railway **et** un `pg_dump` quotidien chiffré vers le stockage S3 (job cron Railway), rétention 30 jours.
- Environnements Railway : `staging` et `production`.

## 3. Rôles et permissions

Un utilisateur a un rôle **par entité** (table `UserEntityRole`) : il peut être Caissier à l'École et sans accès à SEC.

| Rôle | Peut |
|---|---|
| `ADMIN` | gérer utilisateurs, entités, plafonds, catégories, paramètres. N'enregistre pas d'opérations financières. |
| `CONTROLLER` (assistante) | voir les deux entités, examiner/approuver dans son plafond, transmettre au chef, enregistrer recettes/dépenses/transferts, rapprochement, clôtures, rapports, contre-passations |
| `DIRECTOR` (chef hiérarchique) | approuver/rejeter les demandes transmises, valider les contre-passations au-delà d'un seuil, tout consulter |
| `CASHIER` | décaisser les demandes approuvées sur ses caisses, enregistrer entrées/sorties de caisse, clôture journalière de sa caisse |
| `REQUESTER` | créer ses demandes de fonds, confirmer la réception, déposer les justificatifs |
| `VIEWER` | lecture seule (rapports, tableaux de bord) |

Implémentation : option `permission` du wrapper `handler()` (`src/server/http.ts`), ex. `handler({ permission: 'fundRequest.approve', entityFrom: 'body' }, async (ctx) => ...)`, plus `assertCan(user, permission, entityId)` appelé dans les services. Matrice `role → permissions[]` dans `src/lib/permissions.ts`. Accès aux comptes bancaires : en plus du rôle, table `AccountAccess` optionnelle (restreindre un compte à certains utilisateurs).

**Séparation des tâches (vérifiée côté service)** :
- le demandeur ne peut pas approuver ni décaisser sa propre demande ;
- l'approbateur ne peut pas décaisser la même demande (bloquant ; une option admin `allowSameApproverCashier` peut lever ce blocage si l'équipe est trop petite, avec mention dans l'audit) ;
- la clôture finale d'une demande est faite par un `CONTROLLER` différent du demandeur.

## 4. Modèle de données (Prisma)

Esquisse à compléter (index, contraintes). Tous les montants en `Decimal @db.Decimal(18, 2)`.

```prisma
enum EntityCode { SEC  ECOLE }
enum Currency   { USD  CDF }
enum Role       { ADMIN CONTROLLER DIRECTOR CASHIER REQUESTER VIEWER }
enum AccountType { CASH BANK }

model Entity {
  id     String     @id @default(cuid())
  code   EntityCode @unique
  name   String
  accounts Account[]
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  fullName     String
  passwordHash String              // argon2id
  totpSecretEnc String?            // chiffré
  isActive     Boolean  @default(true)
  roles        UserEntityRole[]
  createdAt    DateTime @default(now())
}

model UserEntityRole {
  userId   String
  entityId String
  role     Role
  @@id([userId, entityId, role])
}

model Session {
  id         String   @id            // token aléatoire hashé
  userId     String
  expiresAt  DateTime
  lastSeenAt DateTime
  ip         String?
  userAgent  String?
  stepUpUntil DateTime?              // 2FA récente pour opérations sensibles
}

model LoginEvent { id String @id @default(cuid()); userId String?; email String; success Boolean; ip String?; userAgent String?; at DateTime @default(now()) }

// Caisse OU compte bancaire : une seule devise par compte
model Account {
  id            String      @id @default(cuid())
  entityId      String
  type          AccountType
  name          String                // "Caisse principale", "Rawbank USD"
  currency      Currency
  bankName      String?
  holderName    String?
  accountNumberEnc String?            // chiffré, affiché masqué ****1234
  isActive      Boolean     @default(true)
  openedAt      DateTime
  entries       LedgerEntry[]
}

// Une opération métier = 1 Transaction comptable = N écritures
model FinancialTransaction {
  id          String   @id @default(cuid())
  reference   String   @unique          // ECO-VER-2026-00012
  entityId    String                    // entité "propriétaire" (pour inter-entités : l'entité qui décaisse)
  kind        TxKind
  date        DateTime                  // date de valeur
  description String
  status      TxStatus @default(POSTED)
  reversalOfId String?  @unique         // si contre-passation
  reversalReason String?
  createdById String
  createdAt   DateTime @default(now())
  entries     LedgerEntry[]
  attachments Attachment[]
  fx          FxConversion?
  // liens métier optionnels
  fundRequestId String?
  incomeId      String?
  expenseId     String?
  advanceId     String?
}

enum TxKind {
  OPENING_BALANCE INCOME EXPENSE
  CASH_TO_BANK BANK_TO_CASH BANK_TO_BANK CASH_TO_CASH
  BANK_FEE ADVANCE_DISBURSEMENT ADVANCE_REPAYMENT
  CASH_ADJUSTMENT REVERSAL
}
enum TxStatus { POSTED REVERSED }

model LedgerEntry {
  id         String   @id @default(cuid())
  txId       String
  accountId  String
  amount     Decimal  @db.Decimal(18, 2)   // signé : + entrée, - sortie, dans la devise du compte
  currency   Currency                      // = devise du compte (contrôlé)
  createdAt  DateTime @default(now())
  @@index([accountId, createdAt])
}

model FxConversion {
  id           String   @id @default(cuid())
  txId         String   @unique
  fromAmount   Decimal  @db.Decimal(18, 2)
  fromCurrency Currency
  toAmount     Decimal  @db.Decimal(18, 2)
  toCurrency   Currency
  rate         Decimal  @db.Decimal(18, 6)  // 1 fromCurrency = rate toCurrency
  rateDate     DateTime
  rateSource   String                       // "BCC", "Banque", "Marché", "Manuel"
}

model ExchangeRate { id String @id @default(cuid()); date DateTime; base Currency; quote Currency; rate Decimal @db.Decimal(18,6); source String; createdById String; @@unique([date, base, quote, source]) }

model Category { id String @id @default(cuid()); entityId String; kind CategoryKind; name String; isActive Boolean @default(true) }
enum CategoryKind { INCOME EXPENSE }

model Department { id String @id @default(cuid()); entityId String; name String }   // départements / sections

model Income {
  id String @id @default(cuid()); reference String @unique; entityId String
  date DateTime; source String                // partenaire, "Frais scolaires", ...
  categoryId String; amount Decimal @db.Decimal(18,2); currency Currency
  paymentMethod PaymentMethod; accountId String  // caisse/banque qui reçoit
  note String?; createdById String
}

model Expense {
  id String @id @default(cuid()); reference String @unique; entityId String
  date DateTime; categoryId String; departmentId String?; beneficiary String; purpose String
  amount Decimal @db.Decimal(18,2); currency Currency; paymentMethod PaymentMethod
  accountId String; fundRequestId String?; createdById String
}
enum PaymentMethod { CASH BANK_TRANSFER CHEQUE MOBILE_MONEY OTHER }

model FundRequest {
  id String @id @default(cuid()); reference String @unique
  entityId     String          // entité bénéficiaire de la dépense
  requesterId  String; departmentId String?
  amount Decimal @db.Decimal(18,2); currency Currency
  purpose String; status FundRequestStatus @default(DRAFT)
  submittedAt DateTime?
  approvalLevel ApprovalLevel?  // CONTROLLER | DIRECTOR
  disbursedFromAccountId String? // peut appartenir à l'AUTRE entité → avance
  closedAt DateTime?
  events FundRequestEvent[]
  attachments Attachment[]
}
enum FundRequestStatus { DRAFT SUBMITTED UNDER_REVIEW ESCALATED APPROVED REJECTED DISBURSED RECEIVED JUSTIFIED CLOSED CANCELLED }
enum ApprovalLevel { CONTROLLER DIRECTOR }

model FundRequestEvent { id String @id @default(cuid()); fundRequestId String; fromStatus FundRequestStatus?; toStatus FundRequestStatus; actorId String; comment String?; at DateTime @default(now()) }

model ApprovalLimit {           // plafonds configurables
  id String @id @default(cuid()); entityId String; role Role; currency Currency
  maxAmount Decimal @db.Decimal(18,2)
  @@unique([entityId, role, currency])
}

model InterEntityAdvance {
  id String @id @default(cuid()); reference String @unique
  lenderEntityId   String     // ex. ECOLE
  borrowerEntityId String     // ex. SEC
  amount Decimal @db.Decimal(18,2); currency Currency
  date DateTime; fundRequestId String?; description String
  status AdvanceStatus @default(OPEN)
  repayments AdvanceRepayment[]
}
enum AdvanceStatus { OPEN PARTIALLY_REPAID REPAID CANCELLED }

model AdvanceRepayment {
  id String @id @default(cuid()); advanceId String; txId String @unique
  amount Decimal @db.Decimal(18,2); currency Currency   // devise de l'avance (conversion via FxConversion si payé dans l'autre devise)
  date DateTime
}

model CashSession {              // clôture journalière de caisse
  id String @id @default(cuid()); accountId String; date DateTime
  theoreticalBalance Decimal @db.Decimal(18,2)
  countedBalance     Decimal @db.Decimal(18,2)
  difference         Decimal @db.Decimal(18,2)
  justification String?; closedById String; closedAt DateTime
  denominations Json?            // comptage par billets
  @@unique([accountId, date])
}

model Budget { id String @id @default(cuid()); entityId String; name String; periodStart DateTime; periodEnd DateTime; currency Currency; lines BudgetLine[] }
model BudgetLine { id String @id @default(cuid()); budgetId String; departmentId String?; categoryId String?; amount Decimal @db.Decimal(18,2) }

model BankStatement { id String @id @default(cuid()); accountId String; periodStart DateTime; periodEnd DateTime; openingBalance Decimal @db.Decimal(18,2); closingBalance Decimal @db.Decimal(18,2); fileId String; importedById String; lines BankStatementLine[]; status ReconStatus @default(IN_PROGRESS) }
model BankStatementLine { id String @id @default(cuid()); statementId String; date DateTime; label String; reference String?; amount Decimal @db.Decimal(18,2); matchStatus MatchStatus @default(UNMATCHED); matchedEntryId String?; matchConfidence Int?; confirmedById String? }
enum ReconStatus { IN_PROGRESS SUBMITTED VALIDATED }
enum MatchStatus { UNMATCHED SUGGESTED MATCHED IGNORED CREATED }

model Attachment { id String @id @default(cuid()); storageKey String; fileName String; mimeType String; size Int; sha256 String; uploadedById String; uploadedAt DateTime @default(now()); kind AttachmentKind; /* liens polymorphes via colonnes nullable */ txId String?; fundRequestId String?; expenseId String?; incomeId String? }
enum AttachmentKind { RECEIPT INVOICE SIGNED_REGISTER BANK_STATEMENT OTHER }

model ReferenceCounter { entityCode EntityCode; docType String; year Int; lastValue Int; @@id([entityCode, docType, year]) }

model AuditLog { id String @id @default(cuid()); actorId String?; action String; entityType String; entityId String; before Json?; after Json?; ip String?; at DateTime @default(now()); @@index([entityType, entityId]) }
```

Contraintes à ajouter en SQL brut dans une migration :
- `CHECK` : `LedgerEntry.currency` = devise du compte (via trigger) ;
- trigger `BEFORE DELETE` sur `LedgerEntry`, `FinancialTransaction`, `AuditLog` → `RAISE EXCEPTION` ;
- `UPDATE` interdit sur `LedgerEntry.amount` (trigger).

## 5. Moteur de grand livre (soldes)

Fichier central : `src/server/ledger.ts`. **Toute écriture financière passe par lui.**

```ts
postTransaction(tx: PrismaTx, input: {
  entityId, kind, date, description, createdById,
  lines: { accountId: string; amount: Decimal }[],   // signés
  fx?: FxInput, links?: {...}
}): Promise<FinancialTransaction>
```

Règles appliquées par `postTransaction` :
1. Verrouille les comptes concernés (`SELECT id FROM "Account" WHERE id = ANY($1) ORDER BY id FOR UPDATE`) — ordre trié pour éviter les deadlocks.
2. Vérifie que chaque compte est actif et que l'utilisateur y a accès.
3. Pour chaque ligne négative sur un compte `CASH`, vérifie solde ≥ montant (pas de caisse négative). Pour `BANK`, solde négatif autorisé seulement si option découvert sur le compte.
4. **Équilibre** : si toutes les lignes sont dans la même devise et que `kind` est un transfert, la somme doit être 0. Si devises différentes → `fx` obligatoire et cohérent (`fromAmount × rate = toAmount`, arrondi à 2 décimales, tolérance 0,01).
5. Génère la référence via `nextReference(tx, entityCode, docType)`.
6. Écrit l'`AuditLog`.

Solde d'un compte : `SUM(amount) FROM LedgerEntry WHERE accountId = ? [AND date <= ?]`. Si les performances l'exigent plus tard : table `AccountBalance` mise à jour dans la même transaction (jamais en dehors).

**Mapping opérations → écritures**

| Opération | Écritures |
|---|---|
| Solde initial | `+X` sur le compte (OPENING_BALANCE) |
| Recette | `+X` caisse/banque qui reçoit (INCOME) |
| Dépense / décaissement | `−X` caisse/banque qui paie (EXPENSE) |
| Versement caisse → banque | `−X` caisse, `+X` banque (CASH_TO_BANK) |
| Retrait banque → caisse | `−X` banque, `+X` caisse (BANK_TO_CASH) — créé seulement à la **confirmation de réception** des fonds |
| Virement entre comptes | `−X` compte A, `+X` compte B ; si devises différentes `+Y` avec FxConversion |
| Frais bancaires | `−X` banque (BANK_FEE), catégorie de dépense « Frais bancaires » |
| Avance École → SEC | `−X` sur le compte de l'École qui paie (ADVANCE_DISBURSEMENT) + création `InterEntityAdvance` ; le décaissement couvre la dépense de SEC (l'`Expense` est rattachée à **SEC**) |
| Remboursement SEC → École | `−X` compte SEC, `+X` compte École (ADVANCE_REPAYMENT) + `AdvanceRepayment` ; met à jour le statut de l'avance |
| Écart de caisse validé | `±X` caisse (CASH_ADJUSTMENT), avec justification |
| Correction | REVERSAL : écritures inverses de l'original, original → `REVERSED` |

**Totaux recettes/dépenses** : calculés uniquement à partir de `kind IN (INCOME)` et `kind IN (EXPENSE, BANK_FEE)` (+ dépenses payées par avance pour l'entité emprunteuse). Les `CASH_TO_BANK`, `BANK_TO_CASH`, `BANK_TO_BANK`, `CASH_TO_CASH`, `ADVANCE_*` sont exclus. Un test doit le garantir.

## 6. Modules métier

### 6.1 Demandes de fonds

Formulaire : entité, demandeur (auto), département/section, montant, devise, motif détaillé, pièces jointes. Référence auto `SEC-DF-2026-00001`.

**Machine à états** (implémentée dans `fundRequests/service.ts`, chaque transition = `FundRequestEvent` + audit) :

```
DRAFT ─submit→ SUBMITTED ─review→ UNDER_REVIEW
UNDER_REVIEW ─approve (montant ≤ plafond CONTROLLER)→ APPROVED
UNDER_REVIEW ─escalate (obligatoire si > plafond)→ ESCALATED ─approve/reject (DIRECTOR)→ APPROVED | REJECTED
UNDER_REVIEW ─reject→ REJECTED
APPROVED ─disburse (CASHIER, choisit le compte)→ DISBURSED
DISBURSED ─confirmReceipt (REQUESTER)→ RECEIVED
RECEIVED ─attach justificatifs→ JUSTIFIED
JUSTIFIED ─close (CONTROLLER, après vérification)→ CLOSED
DRAFT|SUBMITTED ─cancel (demandeur)→ CANCELLED
```

- Plafonds dans `ApprovalLimit` (par entité, rôle, devise). Si l'assistante tente d'approuver au-dessus de son plafond → erreur `APPROVAL_LIMIT_EXCEEDED`, bouton « Transmettre au chef ».
- `disburse` crée l'`Expense` + la `FinancialTransaction` dans **une seule transaction DB**. Si le compte choisi appartient à l'autre entité → flux avance (6.6), avec confirmation explicite dans l'UI (« La caisse de l'École va avancer 2 000 USD à SEC SARL »).
- Rejet : commentaire obligatoire.
- Notifications in-app (table `Notification`) au demandeur et aux acteurs suivants ; e-mail optionnel plus tard.

### 6.2 Recettes
Champs : date, référence auto, entité, origine/source, catégorie, montant, devise, mode d'encaissement, compte de réception (même devise), justificatif. Recettes scolaires : saisie de **totaux** (ex. total journalier des frais scolaires) ou import CSV de totaux exportés de PresenceFintech (date, rubrique, montant, devise).

### 6.3 Dépenses
Champs : catégorie, entité, département, bénéficiaire, motif, montant, devise, mode de paiement, compte payeur, demande liée, justificatif, utilisateur. Liste filtrable par période, entité, catégorie, bénéficiaire, département, devise ; pagination serveur ; export Excel.

### 6.4 Caisses
- Création (entité, nom, devise, solde initial → OPENING_BALANCE).
- Entrées/sorties, transferts caisse ↔ caisse (même entité ; entre entités = avance, jamais un simple transfert).
- **Clôture journalière** : affiche le solde théorique, saisie du comptage physique (optionnellement par coupures USD/CDF), calcul de l'écart, justification obligatoire si écart ≠ 0, écriture CASH_ADJUSTMENT seulement après validation par un CONTROLLER. Une fois la journée clôturée, toute écriture antérieure sur cette caisse passe par contre-passation datée du jour.
- État de caisse (PDF) par jour/période.

### 6.5 Banques
- Plusieurs banques et comptes par entité ; numéro de compte chiffré (AES-256-GCM, clé en variable d'env), affiché masqué.
- Opérations : versement, retrait, virement entrant/sortant, transfert entre comptes, commissions, frais de tenue, autres prélèvements.
- **Retrait en deux temps** : `initiate` (statut « en transit », aucune écriture) → `confirmReceipt` par le caissier (écritures BANK_TO_CASH). Prévoir une entité `PendingTransfer` ou un statut sur la transaction.

### 6.6 Avances inter-entités
- Création automatique lors d'un décaissement depuis un compte de l'autre entité, ou manuelle (CONTROLLER).
- Fiche avance visible **depuis les deux entités** : prêteur, emprunteur, montant, devise, date, demande d'origine, remboursements, **solde restant** = montant − Σ remboursements.
- Remboursements partiels ; si remboursé dans une autre devise → FxConversion obligatoire, le solde restant est calculé dans la devise de l'avance.
- Dashboard : total des avances ouvertes par sens et par devise, ancienneté (alerte > 30 jours, paramétrable).

### 6.7 Multidevises
- Chaque compte a une devise ; chaque opération garde sa devise d'origine.
- Table `ExchangeRate` saisie par le CONTROLLER (taux du jour, source). Le formulaire de conversion propose le dernier taux mais il reste modifiable ; on stocke toujours taux + date + source + contre-valeur.
- Rapports : totaux **par devise** par défaut ; la contre-valeur consolidée (ex. tout en USD) est une option qui affiche clairement le taux utilisé.

### 6.8 Budgets et engagements
- Budget par entité/période/devise, réparti en lignes (département et/ou catégorie).
- Pour chaque ligne : budget, **engagé** (demandes APPROVED non encore DISBURSED), **réalisé** (dépenses), disponible = budget − engagé − réalisé, % consommé.
- Alerte de dépassement à 80 % et 100 % ; avertissement (non bloquant en v1) lors de l'approbation d'une demande qui dépasserait la ligne.
- Prévision de trésorerie simple : soldes actuels − engagements + recettes moyennes des N dernières semaines.

### 6.9 Rapprochement bancaire
1. Import CSV/XLSX du relevé ; écran de **mapping des colonnes** (date, libellé, référence, débit/crédit ou montant signé) mémorisé par banque.
2. Algorithme de suggestion (`src/server/modules/reconciliation/matcher.ts`), par ordre :
   - même montant exact + même référence → confiance 100 ;
   - même montant + date ±3 jours → 80 ;
   - même montant + date ±7 jours → 50 ;
   - plusieurs candidats → `SUGGESTED` avec liste, jamais auto-confirmé.
   Seul le score 100 avec candidat unique peut être pré-coché ; **toute correspondance est confirmée par un utilisateur autorisé**.
3. Résultats affichés en 4 colonnes : correspondances, lignes du relevé non enregistrées (bouton « créer l'opération », ex. frais bancaires), écritures absentes du relevé, écarts de montant. Détection de doublons (même montant + même date + libellé similaire).
4. État de rapprochement : solde relevé vs solde comptable, éléments en suspens, écart final → PDF, soumis puis validé.

## 7. Registres papier et documents PDF

Approche hybride : le papier reste, l'appli produit des documents imprimables.

Registres (PDF, par entité, période ou opération) : entrées, sorties, demandes de fonds, retraits bancaires, versements bancaires, avances, remboursements, journaliers et mensuels.

Chaque document contient : en-tête entité, titre, numéro, date, référence de l'opération, motif, **montant en chiffres et en lettres** (français, ex. « deux mille dollars américains », « cinq cent mille francs congolais » — utiliser `n2words` langue `fr` + suffixe devise, avec tests), identité des personnes concernées, **cases de signature** (demandeur, approbateur, caissier, bénéficiaire), pied de page « Généré le … par … — page x/y ».

Le document signé est ensuite **photographié/scanné et rattaché** à l'opération (`AttachmentKind.SIGNED_REGISTER`). Upload depuis mobile (input `capture="environment"`), compression image côté client, max 10 Mo, types autorisés : JPEG, PNG, PDF. Stockage S3 privé, accès par URL signée de courte durée après contrôle des droits. Hash SHA-256 stocké.

## 8. Rapports et tableau de bord

### 8.1 Tableau de bord (accueil)
Filtre entité : `SEC` | `École` | `Vue consolidée` (deux colonnes côte à côte, jamais fusionnées). Tuiles par devise : recettes et dépenses de la période, soldes caisses, soldes banques, demandes en attente (par statut), opérations bancaires récentes, avances non remboursées, écarts de caisse, rapprochements en attente, alertes (dépassements budget, avances anciennes, caisses non clôturées, doublons potentiels).

### 8.2 Rapports
| Fréquence | Contenu |
|---|---|
| Journalier | recettes, dépenses, état des caisses, état des banques, versements/retraits, demandes traitées, écarts, opérations en attente |
| Hebdomadaire | évolution recettes/dépenses, comparaison des deux entités, avances, remboursements, dépenses par catégorie, opérations inhabituelles |
| Mensuel | synthèse par entité, situation consolidée, comptes bancaires, caisses, analyse budgétaire, avances, frais bancaires, rapprochements, tendances |

- Chaque rapport = une fonction `buildReport(type, params) → ReportData` (JSON typé) + deux rendus : PDF et Excel (`exceljs`, une feuille par section, montants en format numérique avec devise).
- Génération synchrone dans le Route Handler en v1 (`export const maxDuration` si nécessaire) ; si un rapport dépasse ~10 s, ajouter Redis + un service `worker` Railway (BullMQ) qui réutilise `src/server`.
- « Opérations inhabituelles » v1 : dépense > 3× la moyenne de sa catégorie sur 90 jours, ou doublon (même bénéficiaire + montant sur 7 jours).

## 9. Sécurité et contrôle interne

- **Auth** : e-mail + mot de passe (argon2id), sessions en base, cookie `httpOnly; Secure; SameSite=Lax`, expiration d'inactivité 30 min, durée max 12 h. Pas de JWT dans le localStorage.
- **2FA TOTP** (`otplib`) obligatoire pour ADMIN, CONTROLLER, DIRECTOR, CASHIER. **Step-up** (re-saisie du code TOTP, valable 5 min) pour : décaissement, approbation au-delà d'un seuil, contre-passation, modification des plafonds, création/modification de compte bancaire, validation d'un rapprochement.
- Rate limiting sur login (compteur en base par e-mail + IP, ou Redis plus tard), verrouillage après 5 échecs (15 min).
- En-têtes de sécurité via `headers()` dans `next.config.ts` (CSP, `X-Frame-Options`, `Referrer-Policy`, HSTS) ; protection CSRF : sur toute requête non-GET, `handler()` vérifie que l'en-tête `Origin` = `APP_URL` ; validation Zod de tous les inputs.
- Historique des connexions (`LoginEvent`), sessions actives visibles et révocables.
- Journal d'audit consultable (filtres utilisateur, entité, action, période), non modifiable.
- Corrections : uniquement par contre-passation motivée ; au-delà d'un seuil, validation DIRECTOR.
- Sauvegardes automatiques (cf. 2.3) + test de restauration documenté.
- Logs applicatifs structurés (`pino`), sans données sensibles (pas de numéros de compte ni de mots de passe).

## 10. API REST — endpoints (préfixe `/api/v1`, Route Handlers Next.js)

Chaque ligne correspond à un fichier `src/app/api/v1/<chemin>/route.ts` (segments dynamiques `[id]`). Les actions de la machine à états sont des sous-routes, ex. `src/app/api/v1/fund-requests/[id]/approve/route.ts`.

```
POST   /auth/login                 POST /auth/logout          GET /auth/me
POST   /auth/totp/setup|verify     POST /auth/step-up
GET    /entities
GET    /users  POST /users  PATCH /users/:id  PUT /users/:id/roles          (ADMIN)
GET    /settings/approval-limits   PUT /settings/approval-limits            (ADMIN)
CRUD   /categories  /departments

GET    /accounts?entityId&type     POST /accounts      PATCH /accounts/:id
GET    /accounts/:id/balance?at=   GET  /accounts/:id/ledger?from&to&page

GET    /fund-requests?entityId&status&requesterId&from&to&page
POST   /fund-requests              GET /fund-requests/:id    PATCH /fund-requests/:id (DRAFT)
POST   /fund-requests/:id/{submit|review|approve|reject|escalate|disburse|confirm-receipt|justify|close|cancel}

GET|POST /incomes                  GET /incomes/:id
GET|POST /expenses                 GET /expenses/:id
POST   /transactions/:id/reverse   { reason }

POST   /cash/:accountId/movements
POST   /cash/:accountId/closings   GET /cash/:accountId/closings
POST   /cash/closings/:id/validate

POST   /bank/deposits              (caisse → banque)
POST   /bank/withdrawals           POST /bank/withdrawals/:id/confirm-receipt
POST   /bank/transfers             POST /bank/fees

GET|POST /exchange-rates           GET /exchange-rates/latest?base&quote

GET    /advances?entityId&status   POST /advances   GET /advances/:id
POST   /advances/:id/repayments

CRUD   /budgets   GET /budgets/:id/execution

POST   /bank-statements (multipart)   GET /bank-statements/:id
POST   /bank-statements/:id/auto-match
POST   /bank-statements/:id/lines/:lineId/{confirm|ignore|create-transaction}
POST   /bank-statements/:id/{submit|validate}

POST   /attachments (multipart)    GET /attachments/:id/url (URL signée)

GET    /dashboard?entity=SEC|ECOLE|ALL&from&to
GET    /reports/:type?entity&from&to&format=json|pdf|xlsx
GET    /registers/:type?entity&from&to       GET /documents/:txId.pdf
GET    /audit-logs?...
GET    /health
```

Conventions : pagination `?page&pageSize` → `{ data, page, pageSize, total }` ; montants en chaînes ; dates ISO 8601 ; idempotence via en-tête `Idempotency-Key` sur toutes les opérations financières (`disburse`, `deposits`, `withdrawals`, `transfers`, `repayments`, `reverse`) pour éviter les doublons en cas de double clic ou de réseau instable.

## 11. Écrans Next.js

App Router, routes groupées : `(auth)/login`, `(app)/...` protégé par le middleware Next.js qui redirige vers `/login` si le cookie est absent (la vérification réelle de session et de droits est faite côté serveur dans `handler()` et dans les layouts serveur via `getCurrentUser()`). Les pages de lecture peuvent charger leurs données dans des Server Components en appelant les services ; les formulaires et actions utilisent l'API `/api/v1` via TanStack Query. Sélecteur d'entité global dans la barre du haut (persisté en cookie). **Responsive mobile prioritaire** pour : création de demande, confirmation de réception, upload de justificatifs, décaissement caissier.

```
/                         tableau de bord
/demandes                 liste + filtres ; /demandes/nouvelle ; /demandes/[id] (timeline des événements, actions selon rôle)
/recettes  /depenses      listes, formulaires, détail
/caisses                  liste avec soldes ; /caisses/[id] (mouvements, clôture du jour)
/banques                  comptes ; /banques/[id] (opérations, relevés) ; /banques/operations/nouvelle
/avances                  liste par sens ; /avances/[id] (remboursements, solde restant)
/budgets                  /budgets/[id] (exécution par ligne, barres de progression)
/rapprochements           /rapprochements/[id] (vue 4 colonnes)
/taux-de-change
/rapports                 choix du type + période + entité → aperçu + export PDF/Excel
/registres
/audit
/parametres               utilisateurs, rôles, plafonds, catégories, départements, comptes
/profil                   2FA, sessions actives
```

Composants partagés : `<MoneyInput currency>` (saisie en chaîne, jamais de float), `<Money value currency>`, `<EntityBadge>`, `<StatusBadge>`, `<AttachmentUploader>`, `<StepUpDialog>` (demande le code TOTP quand l'API répond `STEP_UP_REQUIRED`), `<ConfirmDialog>` récapitulatif avant toute opération financière.

## 12. Plan de développement par phases

Chaque phase se termine par : tests verts, typecheck/lint OK, déploiement sur `staging` Railway.

**Phase 0 — Fondations (≈ 3 jours)**
App Next.js (TypeScript strict, Tailwind, shadcn/ui), arborescence `src/app` / `src/server` / `src/lib`, wrapper `handler()` + `AppError`, Prisma connecté à Postgres Railway, `output: 'standalone'`, healthcheck, CI (lint, typecheck, tests), seed (2 entités, 1 admin).
✅ Service `app` déployé sur Railway staging avec migration en pre-deploy ; `GET /api/v1/health` renvoie `ok` avec la base joignable.

**Phase 1 — Utilisateurs, rôles, sécurité, audit (≈ 1 semaine)**
Login, sessions, 2FA, step-up, rôles par entité, contrôle des permissions dans `handler()` et les services, AuditLog, LoginEvent, écrans paramètres utilisateurs.
✅ Un CASHIER de l'École ne voit aucune donnée de SEC (test). Toute action admin apparaît dans l'audit.

**Phase 2 — Comptes, grand livre, multidevises (≈ 1 semaine)**
`Account`, `lib/ledger.ts`, `lib/money.ts`, références, soldes initiaux, taux de change, triggers anti-suppression.
✅ Tests : solde = Σ écritures ; impossible de rendre une caisse négative ; deux opérations concurrentes sur la même caisse ne passent pas toutes les deux si le solde est insuffisant ; un `DELETE` SQL sur `LedgerEntry` échoue ; conversion stockée avec taux/date/source.

**Phase 3 — Demandes de fonds et circuit d'approbation (≈ 2 semaines)**
Machine à états complète, plafonds, transmission au chef, décaissement, confirmation de réception, justificatifs, clôture, notifications in-app.
✅ Tests de chaque transition autorisée et interdite ; séparation des tâches ; approuvé sans décaissement ne change aucun solde.

**Phase 4 — Recettes, dépenses, caisses, banques (≈ 2 semaines)**
Recettes, dépenses, clôture de caisse avec écarts, opérations bancaires, retrait en deux temps, frais bancaires, contre-passations.
✅ Un versement caisse → banque ne modifie ni le total des recettes ni celui des dépenses (test). Contre-passation remet les soldes à l'identique.

**Phase 5 — Avances inter-entités et budgets (≈ 1,5 semaine)**
Avances (auto depuis décaissement + manuelles), remboursements partiels, budgets, engagés/réalisés, alertes.
✅ Scénario du cahier des charges : SEC demande 2 000 USD, caisse SEC insuffisante, l'École décaisse → avance de 2 000 USD visible des deux côtés, dette SEC = 2 000 ; remboursement de 500 → solde restant 1 500, statut PARTIALLY_REPAID ; la recette de l'École n'augmente pas.

**Phase 6 — Rapprochement bancaire (≈ 1,5 semaine)**
Import CSV/XLSX, mapping, matcher, vue 4 colonnes, création d'opérations depuis le relevé, état de rapprochement PDF.
✅ Jeu de test de relevé avec correspondances exactes, approximatives, ambiguës, frais non enregistrés, doublons : chaque cas est classé correctement ; aucune correspondance ambiguë n'est confirmée automatiquement.

**Phase 7 — Registres, rapports, tableau de bord (≈ 2 semaines)**
Tous les PDF de registres avec montants en lettres et cases de signature, upload des scans signés, rapports journalier/hebdo/mensuel PDF + Excel, tableau de bord complet.
✅ Montant en lettres testé sur un jeu de valeurs (0, 1, 21, 80, 1 000, 2 000 000, centimes). Exports Excel s'ouvrent avec des cellules numériques.

**Phase 8 — Recette, formation, mise en production (≈ 2 semaines)**
Tests Playwright des parcours critiques, test de restauration de sauvegarde, environnement `production` Railway, import des soldes d'ouverture réels, guide utilisateur court.

**Plus tard (hors offre Professional)** : assistant IA en lecture seule (questions en langage naturel → requêtes sur des fonctions de rapport existantes, filtrées par les permissions de l'utilisateur ; aucune écriture possible), détection d'anomalies avancée, e-mails/WhatsApp, intégration PresenceFintech par API.

## 13. Questions ouvertes à valider avec le client

Ne pas inventer de réponse : utiliser une valeur par défaut configurable et la signaler.

1. **Plafonds d'autorisation** de l'assistante par entité et par devise (défaut : 500 USD / 1 400 000 CDF, modifiable).
2. Banques et comptes exacts de chaque entité, soldes d'ouverture et date de démarrage.
3. Liste des catégories de dépenses/recettes et des départements/sections.
4. Source officielle du taux de change (BCC, banque, marché) et qui le saisit.
5. Une caisse peut-elle être négative temporairement ? (défaut : non). Découvert bancaire autorisé ? (défaut : non).
6. Seuil de contre-passation nécessitant la validation du chef.
7. Format des relevés bancaires disponibles (CSV, Excel, PDF uniquement ?). Si PDF uniquement : saisie assistée en v1.
8. Modèle des registres papier actuels (photos des registres existants pour reproduire la mise en page).
9. Durée de conservation des justificatifs et valeur juridique des registres numériques (à confirmer avec la direction / professionnels compétents).
10. Format d'export des totaux depuis PresenceFintech.
