-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH', 'BANK');

-- CreateEnum
CREATE TYPE "TxKind" AS ENUM ('OPENING_BALANCE', 'INCOME', 'EXPENSE', 'CASH_TO_BANK', 'BANK_TO_CASH', 'BANK_TO_BANK', 'CASH_TO_CASH', 'BANK_FEE', 'ADVANCE_DISBURSEMENT', 'ADVANCE_REPAYMENT', 'CASH_ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "name" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "bankName" TEXT,
    "holderName" TEXT,
    "accountNumberEnc" TEXT,
    "accountNumberLast4" TEXT,
    "allowOverdraft" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialTransaction" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" "TxKind" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TxStatus" NOT NULL DEFAULT 'POSTED',
    "reversalOfId" TEXT,
    "reversalReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fundRequestId" TEXT,
    "incomeId" TEXT,
    "expenseId" TEXT,
    "advanceId" TEXT,

    CONSTRAINT "FinancialTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxConversion" (
    "id" TEXT NOT NULL,
    "txId" TEXT NOT NULL,
    "fromAmount" DECIMAL(18,2) NOT NULL,
    "fromCurrency" "Currency" NOT NULL,
    "toAmount" DECIMAL(18,2) NOT NULL,
    "toCurrency" "Currency" NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "rateDate" TIMESTAMP(3) NOT NULL,
    "rateSource" TEXT NOT NULL,

    CONSTRAINT "FxConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "base" "Currency" NOT NULL,
    "quote" "Currency" NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "source" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceCounter" (
    "entityCode" "EntityCode" NOT NULL,
    "docType" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL,

    CONSTRAINT "ReferenceCounter_pkey" PRIMARY KEY ("entityCode","docType","year")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_entityId_type_idx" ON "Account"("entityId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialTransaction_reference_key" ON "FinancialTransaction"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialTransaction_reversalOfId_key" ON "FinancialTransaction"("reversalOfId");

-- CreateIndex
CREATE INDEX "FinancialTransaction_entityId_date_idx" ON "FinancialTransaction"("entityId", "date");

-- CreateIndex
CREATE INDEX "FinancialTransaction_kind_idx" ON "FinancialTransaction"("kind");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_txId_idx" ON "LedgerEntry"("txId");

-- CreateIndex
CREATE UNIQUE INDEX "FxConversion_txId_key" ON "FxConversion"("txId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_date_base_quote_source_key" ON "ExchangeRate"("date", "base", "quote", "source");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_userId_key_key" ON "IdempotencyKey"("userId", "key");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_txId_fkey" FOREIGN KEY ("txId") REFERENCES "FinancialTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxConversion" ADD CONSTRAINT "FxConversion_txId_fkey" FOREIGN KEY ("txId") REFERENCES "FinancialTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Protections du grand livre (règles 3 et 5 : aucune suppression ni modification)
-- forbid_mutation() est définie dans la migration auth_audit.
-- ---------------------------------------------------------------------------
CREATE TRIGGER ledger_entry_immutable
  BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER fx_conversion_immutable
  BEFORE UPDATE OR DELETE ON "FxConversion"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER financial_transaction_no_delete
  BEFORE DELETE ON "FinancialTransaction"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Seuls le statut et le lien de contre-passation d'une transaction peuvent évoluer.
CREATE FUNCTION financial_transaction_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."reference" <> OLD."reference" OR NEW."entityId" <> OLD."entityId" OR NEW."kind" <> OLD."kind"
     OR NEW."date" <> OLD."date" OR NEW."description" <> OLD."description"
     OR NEW."createdById" <> OLD."createdById" THEN
    RAISE EXCEPTION 'Modification interdite sur FinancialTransaction';
  END IF;
  IF OLD."status" = 'REVERSED' AND NEW."status" <> 'REVERSED' THEN
    RAISE EXCEPTION 'Une transaction contre-passée ne peut pas être rétablie';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER financial_transaction_guard
  BEFORE UPDATE ON "FinancialTransaction"
  FOR EACH ROW EXECUTE FUNCTION financial_transaction_guard();

-- La devise d'une écriture doit être celle du compte.
CREATE FUNCTION ledger_entry_currency_check() RETURNS trigger AS $$
DECLARE acc_currency "Currency";
BEGIN
  SELECT "currency" INTO acc_currency FROM "Account" WHERE "id" = NEW."accountId";
  IF acc_currency IS DISTINCT FROM NEW."currency" THEN
    RAISE EXCEPTION 'Devise de l''écriture (%) différente de celle du compte (%)', NEW."currency", acc_currency;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entry_currency_check
  BEFORE INSERT ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION ledger_entry_currency_check();

-- Un compte ne change jamais de devise une fois créé.
CREATE FUNCTION account_currency_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."currency" <> OLD."currency" OR NEW."type" <> OLD."type" OR NEW."entityId" <> OLD."entityId" THEN
    RAISE EXCEPTION 'Devise, type et entité d''un compte sont immuables';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER account_currency_guard
  BEFORE UPDATE ON "Account"
  FOR EACH ROW EXECUTE FUNCTION account_currency_guard();
