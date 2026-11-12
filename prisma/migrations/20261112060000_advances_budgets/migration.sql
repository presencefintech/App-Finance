-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('OPEN', 'PARTIALLY_REPAID', 'REPAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "InterEntityAdvance" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "lenderEntityId" TEXT NOT NULL,
    "borrowerEntityId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "fundRequestId" TEXT,
    "description" TEXT NOT NULL,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterEntityAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvanceRepayment" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvanceRepayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "currency" "Currency" NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "departmentId" TEXT,
    "categoryId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InterEntityAdvance_reference_key" ON "InterEntityAdvance"("reference");

-- CreateIndex
CREATE INDEX "InterEntityAdvance_lenderEntityId_status_idx" ON "InterEntityAdvance"("lenderEntityId", "status");

-- CreateIndex
CREATE INDEX "InterEntityAdvance_borrowerEntityId_status_idx" ON "InterEntityAdvance"("borrowerEntityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AdvanceRepayment_txId_key" ON "AdvanceRepayment"("txId");

-- CreateIndex
CREATE INDEX "AdvanceRepayment_advanceId_idx" ON "AdvanceRepayment"("advanceId");

-- CreateIndex
CREATE INDEX "Budget_entityId_idx" ON "Budget"("entityId");

-- CreateIndex
CREATE INDEX "BudgetLine_budgetId_idx" ON "BudgetLine"("budgetId");

-- AddForeignKey
ALTER TABLE "AdvanceRepayment" ADD CONSTRAINT "AdvanceRepayment_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "InterEntityAdvance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Les remboursements ne se suppriment ni ne se modifient (contre-passation de la transaction liée).
CREATE TRIGGER advance_repayment_immutable
  BEFORE UPDATE OR DELETE ON "AdvanceRepayment"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
