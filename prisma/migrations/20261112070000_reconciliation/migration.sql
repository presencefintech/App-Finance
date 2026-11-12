-- CreateEnum
CREATE TYPE "ReconStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'VALIDATED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('UNMATCHED', 'SUGGESTED', 'MATCHED', 'IGNORED', 'CREATED');

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(18,2) NOT NULL,
    "closingBalance" DECIMAL(18,2) NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "fileData" BYTEA,
    "storageKey" TEXT,
    "status" "ReconStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "importedById" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "validationNote" TEXT,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "matchStatus" "MatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedEntryId" TEXT,
    "matchConfidence" INTEGER,
    "candidateIds" JSONB,
    "duplicateOfId" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankColumnMapping" (
    "accountId" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankColumnMapping_pkey" PRIMARY KEY ("accountId")
);

-- CreateIndex
CREATE INDEX "BankStatement_accountId_idx" ON "BankStatement"("accountId");

-- CreateIndex
CREATE INDEX "BankStatementLine_statementId_idx" ON "BankStatementLine"("statementId");

-- CreateIndex
CREATE INDEX "BankStatementLine_matchedEntryId_idx" ON "BankStatementLine"("matchedEntryId");

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Un relevé n'est jamais supprimé ; ses lignes non plus (les cascades ne s'appliquent qu'aux brouillons via l'application).
CREATE TRIGGER bank_statement_no_delete
  BEFORE DELETE ON "BankStatement"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
