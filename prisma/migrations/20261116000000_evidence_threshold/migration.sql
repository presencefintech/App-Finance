-- Seuil de justificatif obligatoire (recettes et dépenses), par entité et par devise
CREATE TABLE "EvidenceThreshold" (
    "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'::text, true),
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "minAmount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "EvidenceThreshold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EvidenceThreshold_entityId_currency_key" ON "EvidenceThreshold"("entityId", "currency");
CREATE INDEX "EvidenceThreshold_organizationId_idx" ON "EvidenceThreshold"("organizationId");

-- Nettoyage des pièces déposées sans opération
CREATE INDEX "Attachment_uploadedAt_idx" ON "Attachment"("uploadedAt");

-- Isolation par organisation (RLS), comme les autres tables métier
ALTER TABLE "EvidenceThreshold" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EvidenceThreshold" USING ("organizationId" = current_setting('app.org_id', true)) WITH CHECK ("organizationId" = current_setting('app.org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "EvidenceThreshold" TO sec_app;
