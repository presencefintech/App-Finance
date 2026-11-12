-- CreateEnum
CREATE TYPE "PendingTransferStatus" AS ENUM ('IN_TRANSIT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('PENDING_VALIDATION', 'CLOSED');

-- CreateTable
CREATE TABLE "PendingTransfer" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "PendingTransferStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "initiatedById" TEXT NOT NULL,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "txId" TEXT,

    CONSTRAINT "PendingTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "theoreticalBalance" DECIMAL(18,2) NOT NULL,
    "countedBalance" DECIMAL(18,2) NOT NULL,
    "difference" DECIMAL(18,2) NOT NULL,
    "justification" TEXT,
    "denominations" JSONB,
    "status" "CashSessionStatus" NOT NULL,
    "closedById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "adjustmentTxId" TEXT,

    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingTransfer_reference_key" ON "PendingTransfer"("reference");

-- CreateIndex
CREATE INDEX "PendingTransfer_entityId_status_idx" ON "PendingTransfer"("entityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CashSession_accountId_date_key" ON "CashSession"("accountId", "date");


-- Une clôture de caisse n'est jamais supprimée.
CREATE TRIGGER cash_session_no_delete
  BEFORE DELETE ON "CashSession"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
