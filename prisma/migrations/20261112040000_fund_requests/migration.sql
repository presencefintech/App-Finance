-- CreateEnum
CREATE TYPE "FundRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ESCALATED', 'APPROVED', 'REJECTED', 'DISBURSED', 'RECEIVED', 'JUSTIFIED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalLevel" AS ENUM ('CONTROLLER', 'DIRECTOR');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'MOBILE_MONEY', 'OTHER');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('RECEIPT', 'INVOICE', 'SIGNED_REGISTER', 'BANK_STATEMENT', 'OTHER');

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" "CategoryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Income" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "accountId" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Income_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "departmentId" TEXT,
    "beneficiary" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "accountId" TEXT NOT NULL,
    "fundRequestId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "departmentId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "FundRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "approvalLevel" "ApprovalLevel",
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "disbursedFromAccountId" TEXT,
    "disbursedById" TEXT,
    "disbursedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundRequestEvent" (
    "id" TEXT NOT NULL,
    "fundRequestId" TEXT NOT NULL,
    "fromStatus" "FundRequestStatus",
    "toStatus" "FundRequestStatus" NOT NULL,
    "actorId" TEXT NOT NULL,
    "comment" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalLimit" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "currency" "Currency" NOT NULL,
    "maxAmount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "ApprovalLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "data" BYTEA,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entityId" TEXT NOT NULL,
    "txId" TEXT,
    "fundRequestId" TEXT,
    "expenseId" TEXT,
    "incomeId" TEXT,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_entityId_name_key" ON "Department"("entityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_entityId_kind_name_key" ON "Category"("entityId", "kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Income_reference_key" ON "Income"("reference");

-- CreateIndex
CREATE INDEX "Income_entityId_date_idx" ON "Income"("entityId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_reference_key" ON "Expense"("reference");

-- CreateIndex
CREATE INDEX "Expense_entityId_date_idx" ON "Expense"("entityId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FundRequest_reference_key" ON "FundRequest"("reference");

-- CreateIndex
CREATE INDEX "FundRequest_entityId_status_idx" ON "FundRequest"("entityId", "status");

-- CreateIndex
CREATE INDEX "FundRequest_requesterId_idx" ON "FundRequest"("requesterId");

-- CreateIndex
CREATE INDEX "FundRequestEvent_fundRequestId_idx" ON "FundRequestEvent"("fundRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalLimit_entityId_role_currency_key" ON "ApprovalLimit"("entityId", "role", "currency");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Attachment_fundRequestId_idx" ON "Attachment"("fundRequestId");

-- CreateIndex
CREATE INDEX "Attachment_txId_idx" ON "Attachment"("txId");

-- AddForeignKey
ALTER TABLE "FundRequestEvent" ADD CONSTRAINT "FundRequestEvent_fundRequestId_fkey" FOREIGN KEY ("fundRequestId") REFERENCES "FundRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_fundRequestId_fkey" FOREIGN KEY ("fundRequestId") REFERENCES "FundRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Historique des demandes et pièces justificatives : non modifiables / non supprimables.
CREATE TRIGGER fund_request_event_immutable
  BEFORE UPDATE OR DELETE ON "FundRequestEvent"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER attachment_no_delete
  BEFORE DELETE ON "Attachment"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
