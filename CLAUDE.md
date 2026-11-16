# CLAUDE.md — Fintrax

Tu travailles sur **Fintrax** (anciennement « SEC Finance Control ») : une plateforme de gestion financière, de trésorerie, de contrôle bancaire et de reporting pour **deux entités indépendantes** — **SEC SARL** et **l'École** (Kolwezi, RDC).

La spécification fonctionnelle et technique complète est dans **`docs/SPEC.md`**. Lis la section concernée avant chaque tâche. Ce fichier-ci contient les règles qui s'appliquent tout le temps.

---

## Stack (décidée, ne pas changer sans demander)

| Couche | Choix |
|---|---|
| Application | **Next.js** (App Router, dernière version stable), une seule app : interface **et** API |
| Front | React, TypeScript strict, Tailwind CSS, shadcn/ui, TanStack Query, React Hook Form |
| API | **Route Handlers Next.js** sous `src/app/api/v1/**/route.ts`, API REST, `runtime = 'nodejs'` (jamais edge) |
| Base de données | **PostgreSQL hébergé sur Railway** |
| ORM | **Prisma** (`prisma/schema.prisma`) |
| Validation | **Zod**, schémas partagés front + API dans `src/lib/schemas` |
| Hébergement | **Railway** : 2 services dans un même projet — `app` (Next.js, `output: 'standalone'`) et `postgres`. Redis + worker ajoutés plus tard si besoin |
| PDF / Excel | `pdfkit` (ou `@react-pdf/renderer`) et `exceljs`, générés dans des Route Handlers |
| Tests | Vitest (services + route handlers appelés directement), Playwright (parcours critiques) |

## Structure du repo

```
sec-finance-control/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── app/
│   │   ├── (auth)/login/
│   │   ├── (app)/...                 # écrans (voir SPEC §11)
│   │   └── api/v1/<module>/route.ts  # Route Handlers : HTTP + validation Zod uniquement
│   ├── server/                       # TOUTE la logique métier — import 'server-only'
│   │   ├── modules/<module>/service.ts
│   │   ├── ledger.ts  money.ts  references.ts  audit.ts  auth.ts  permissions.ts
│   │   ├── db.ts                     # singleton PrismaClient
│   │   └── http.ts                   # handler() : session, permissions, erreurs, idempotence
│   ├── lib/                          # code partagé client/serveur : schemas Zod, enums, formatage montants
│   └── components/
├── tests/
├── docs/SPEC.md
└── CLAUDE.md
```

## Règles NON NÉGOCIABLES (logique financière)

1. **Jamais de `number` JavaScript pour un montant.** Montants en `Decimal(18,2)` en base, `Prisma.Decimal` / `decimal.js` côté serveur, chaînes (`"1250.00"`) dans le JSON. Taux de change en `Decimal(18,6)`.
2. **Chaque montant a une devise** (`USD` | `CDF`). On n'additionne **jamais** deux devises différentes sans conversion explicite enregistrée (montant d'origine, devise, taux, date du taux, source, contre-valeur).
3. **Les soldes sont dérivés du grand livre** (`LedgerEntry`), jamais saisis ni modifiés à la main. Seul le solde initial est une écriture d'ouverture.
4. **Toute opération qui touche un solde s'exécute dans `prisma.$transaction`**, avec verrouillage de la ligne du compte (`SELECT ... FOR UPDATE`) avant le contrôle de solde suffisant.
5. **Aucune suppression d'une opération validée.** Une correction = **contre-passation** (écriture inverse liée à l'originale) + motif obligatoire + entrée dans le journal d'audit.
6. **Les transferts (caisse ↔ banque, banque ↔ banque, caisse ↔ caisse) ne sont ni des recettes ni des dépenses.**
7. **Une avance inter-entités n'est pas une recette ni une dépense commerciale** : c'est une créance pour l'entité qui avance et une dette pour l'autre.
8. **Approuvé ≠ décaissé.** Une demande approuvée ne bouge aucun solde ; seul le décaissement crée des écritures.
9. **Séparation entités** : chaque requête est filtrée par `entityId` selon les droits de l'utilisateur. La vue consolidée affiche les deux entités côte à côte, par devise, sans jamais fusionner les données.
10. **Toute action sensible écrit dans `AuditLog`** (qui, quoi, quand, avant/après, IP).
11. **L'IA (phase ultérieure) est en lecture seule** : elle ne peut ni approuver, ni modifier un solde, ni créer une opération.

## Règles spécifiques Next.js

- **Logique métier uniquement dans `src/server/`**, fichiers marqués `import 'server-only'`. Les Route Handlers et les Server Components appellent les services ; aucun calcul financier dans les composants.
- Chaque Route Handler passe par le wrapper `handler()` de `src/server/http.ts` : lecture de la session, contrôle de permission, validation Zod, `Idempotency-Key`, conversion `AppError` → `{ error: { code, message, details? } }`.
- Tous les Route Handlers : `export const runtime = 'nodejs'` et `export const dynamic = 'force-dynamic'`. Aucune donnée financière mise en cache.
- Le **middleware Next.js ne fait qu'une redirection** vers `/login` si le cookie de session est absent. La vraie vérification de session et de permission se fait dans `handler()` et dans les services — jamais seulement dans le middleware.
- Les Server Components peuvent appeler les services directement (lecture). Les mutations côté client passent par l'API REST `/api/v1` (TanStack Query), pas par des Server Actions, pour garder une seule porte d'entrée contrôlée et auditée.
- Paquets natifs/lourds (`argon2`, `pdfkit`, `exceljs`) déclarés dans `serverExternalPackages` de `next.config.ts`.
- Singleton Prisma dans `src/server/db.ts` (pattern `globalThis` pour éviter les connexions multiples en dev).

## Conventions de code

- TypeScript `strict: true`, pas de `any`.
- Erreurs : classe `AppError(code, httpStatus, message)`.
- Références automatiques via `src/server/references.ts` (compteur transactionnel) : `SEC-DF-2026-00042`, `ECO-REC-2026-00107`, etc.
- Interface utilisateur **en français**. Code, noms de variables et commits en anglais.
- Dates stockées en UTC ; affichage en fuseau `Africa/Lubumbashi`.
- Formats d'affichage : `1 250,00 USD`, `2 500 000,00 CDF`.

## Comment travailler

- Suis les **phases de `docs/SPEC.md` §12 dans l'ordre**. Ne commence pas une phase avant que la précédente passe ses critères d'acceptation.
- Pour chaque module : schéma Prisma + migration → schémas Zod → service + tests → Route Handlers → écrans.
- **Écris les tests du service avant de considérer un module fini**, en particulier : soldes, transferts, multidevises, avances, contre-passations, permissions.
- Commandes : `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm prisma migrate dev`.
- Si une règle métier de `SPEC.md` est ambiguë, **demande** au lieu d'inventer — les questions ouvertes sont listées en §13.
