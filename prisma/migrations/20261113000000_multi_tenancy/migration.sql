-- =============================================================================
-- MULTI-TENANCY : organisations, isolation par Row-Level Security.
--
-- ATTENTION : cette migration REMET À ZÉRO les données existantes (environnement de démonstration /
-- recette uniquement). Le modèle change : l'ancien modèle « deux entités d'un même client » ne peut pas être
-- converti sans perdre l'intégrité (avances, utilisateurs communs entre entités). Ne jamais l'appliquer
-- telle quelle sur une base contenant de vraies données.
-- =============================================================================
TRUNCATE TABLE "Entity", "User", "UserEntityRole", "Session", "LoginEvent", "AuditLog", "Account", "FinancialTransaction", "LedgerEntry", "FxConversion", "ExchangeRate", "ReferenceCounter", "IdempotencyKey", "Department", "Category", "Income", "Expense", "FundRequest", "FundRequestEvent", "ApprovalLimit", "Notification", "Setting", "Attachment", "PendingTransfer", "CashSession", "InterEntityAdvance", "AdvanceRepayment", "Budget", "BudgetLine", "BankStatement", "BankStatementLine", "BankColumnMapping" CASCADE;

-- DropIndex
DROP INDEX "Entity_code_key";

-- DropIndex
DROP INDEX "FinancialTransaction_reference_key";

-- DropIndex
DROP INDEX "ExchangeRate_date_base_quote_source_key";

-- DropIndex
DROP INDEX "Income_reference_key";

-- DropIndex
DROP INDEX "Expense_reference_key";

-- DropIndex
DROP INDEX "FundRequest_reference_key";

-- DropIndex
DROP INDEX "PendingTransfer_reference_key";

-- DropIndex
DROP INDEX "InterEntityAdvance_reference_key";

-- AlterTable
ALTER TABLE "Entity" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true),
ADD COLUMN     "prefix" TEXT NOT NULL,
DROP COLUMN "code",
ADD COLUMN     "code" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "organizationId" TEXT DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "UserEntityRole" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "organizationId" TEXT DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "FinancialTransaction" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "FxConversion" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "ExchangeRate" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "ReferenceCounter" DROP CONSTRAINT "ReferenceCounter_pkey",
DROP COLUMN "entityCode",
ADD COLUMN     "entityId" TEXT NOT NULL,
ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true),
ADD CONSTRAINT "ReferenceCounter_pkey" PRIMARY KEY ("entityId", "docType", "year");

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "Income" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "FundRequest" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "FundRequestEvent" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "ApprovalLimit" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "Setting" DROP CONSTRAINT "Setting_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true),
ADD CONSTRAINT "Setting_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "PendingTransfer" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "CashSession" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "InterEntityAdvance" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "AdvanceRepayment" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "BudgetLine" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "BankStatement" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "BankStatementLine" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- AlterTable
ALTER TABLE "BankColumnMapping" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true);

-- DropEnum
DROP TYPE "EntityCode";

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Entity_organizationId_idx" ON "Entity"("organizationId");

-- CreateIndex
CREATE INDEX "UserEntityRole_organizationId_idx" ON "UserEntityRole"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");

-- CreateIndex
CREATE INDEX "Account_organizationId_idx" ON "Account"("organizationId");

-- CreateIndex
CREATE INDEX "FinancialTransaction_organizationId_idx" ON "FinancialTransaction"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialTransaction_organizationId_reference_key" ON "FinancialTransaction"("organizationId", "reference");

-- CreateIndex
CREATE INDEX "LedgerEntry_organizationId_idx" ON "LedgerEntry"("organizationId");

-- CreateIndex
CREATE INDEX "FxConversion_organizationId_idx" ON "FxConversion"("organizationId");

-- CreateIndex
CREATE INDEX "ExchangeRate_organizationId_idx" ON "ExchangeRate"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_organizationId_date_base_quote_source_key" ON "ExchangeRate"("organizationId", "date", "base", "quote", "source");

-- CreateIndex
CREATE INDEX "ReferenceCounter_organizationId_idx" ON "ReferenceCounter"("organizationId");

-- CreateIndex
CREATE INDEX "Department_organizationId_idx" ON "Department"("organizationId");

-- CreateIndex
CREATE INDEX "Category_organizationId_idx" ON "Category"("organizationId");

-- CreateIndex
CREATE INDEX "Income_organizationId_idx" ON "Income"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Income_organizationId_reference_key" ON "Income"("organizationId", "reference");

-- CreateIndex
CREATE INDEX "Expense_organizationId_idx" ON "Expense"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organizationId_reference_key" ON "Expense"("organizationId", "reference");

-- CreateIndex
CREATE INDEX "FundRequest_organizationId_idx" ON "FundRequest"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FundRequest_organizationId_reference_key" ON "FundRequest"("organizationId", "reference");

-- CreateIndex
CREATE INDEX "FundRequestEvent_organizationId_idx" ON "FundRequestEvent"("organizationId");

-- CreateIndex
CREATE INDEX "ApprovalLimit_organizationId_idx" ON "ApprovalLimit"("organizationId");

-- CreateIndex
CREATE INDEX "Notification_organizationId_idx" ON "Notification"("organizationId");

-- CreateIndex
CREATE INDEX "Setting_organizationId_idx" ON "Setting"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_organizationId_key_key" ON "Setting"("organizationId", "key");

-- CreateIndex
CREATE INDEX "Attachment_organizationId_idx" ON "Attachment"("organizationId");

-- CreateIndex
CREATE INDEX "PendingTransfer_organizationId_idx" ON "PendingTransfer"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingTransfer_organizationId_reference_key" ON "PendingTransfer"("organizationId", "reference");

-- CreateIndex
CREATE INDEX "CashSession_organizationId_idx" ON "CashSession"("organizationId");

-- CreateIndex
CREATE INDEX "InterEntityAdvance_organizationId_idx" ON "InterEntityAdvance"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InterEntityAdvance_organizationId_reference_key" ON "InterEntityAdvance"("organizationId", "reference");

-- CreateIndex
CREATE INDEX "AdvanceRepayment_organizationId_idx" ON "AdvanceRepayment"("organizationId");

-- CreateIndex
CREATE INDEX "Budget_organizationId_idx" ON "Budget"("organizationId");

-- CreateIndex
CREATE INDEX "BudgetLine_organizationId_idx" ON "BudgetLine"("organizationId");

-- CreateIndex
CREATE INDEX "BankStatement_organizationId_idx" ON "BankStatement"("organizationId");

-- CreateIndex
CREATE INDEX "BankStatementLine_organizationId_idx" ON "BankStatementLine"("organizationId");

-- CreateIndex
CREATE INDEX "BankColumnMapping_organizationId_idx" ON "BankColumnMapping"("organizationId");

-- ---------------------------------------------------------------------------
-- Rôle applicatif SANS privilège spécial : les superutilisateurs contournent la RLS, l'application doit donc
-- se connecter avec ce rôle (mot de passe posé par le script db:setup-role, jamais dans une migration).
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sec_app') THEN CREATE ROLE sec_app NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO sec_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sec_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sec_app;

-- ---------------------------------------------------------------------------
-- Row-Level Security : chaque requête n'atteint que les lignes de l'organisation portée par la connexion
-- (paramètre app.org_id). Sans paramètre (NULL) : aucune ligne métier n'est visible — échec fermé.
-- ---------------------------------------------------------------------------
ALTER TABLE "Entity" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Entity" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Account" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "FinancialTransaction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FinancialTransaction" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "LedgerEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LedgerEntry" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "FxConversion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FxConversion" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "ExchangeRate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ExchangeRate" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "ReferenceCounter" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReferenceCounter" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Department" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Category" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "Income" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Income" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Expense" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "FundRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FundRequest" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "FundRequestEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FundRequestEvent" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "ApprovalLimit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ApprovalLimit" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Notification" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "Setting" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Setting" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "Attachment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Attachment" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "PendingTransfer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PendingTransfer" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "CashSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CashSession" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "InterEntityAdvance" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InterEntityAdvance" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "AdvanceRepayment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AdvanceRepayment" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "Budget" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Budget" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "BudgetLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BudgetLine" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "BankStatement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BankStatement" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "BankStatementLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BankStatementLine" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));
ALTER TABLE "BankColumnMapping" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BankColumnMapping" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));

-- Organisation : un tenant ne voit que la sienne (la plateforme passe par le rôle propriétaire).
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_organization ON "Organization" USING ("id" = current_setting('app.org_id', true)) WITH CHECK ("id" = current_setting('app.org_id', true));
-- Connexion « système » (authentification) : lecture seule, pour vérifier qu'une organisation est active.
CREATE POLICY system_read ON "Organization" FOR SELECT USING (current_setting('app.org_id', true) IS NULL);

-- Tables d'authentification : lisibles sans contexte (connexion par e-mail avant de connaître l'organisation),
-- mais un tenant ne voit que les utilisateurs de son organisation.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_system ON "User" USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.org_id', true) IS NULL) WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.org_id', true) IS NULL);
ALTER TABLE "UserEntityRole" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_system ON "UserEntityRole" USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.org_id', true) IS NULL) WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.org_id', true) IS NULL);

-- Journal d'audit : par organisation ; les événements de plateforme (sans organisation) sont invisibles aux tenants.
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_audit ON "AuditLog"
  USING ("organizationId" = current_setting('app.org_id', true) OR ("organizationId" IS NULL AND current_setting('app.org_id', true) IS NULL))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR ("organizationId" IS NULL AND current_setting('app.org_id', true) IS NULL));
