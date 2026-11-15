-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_createdAt_idx" ON "PasswordResetToken"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Droits du rôle applicatif (table sans organisation, comme Session : accédée par la connexion système)
GRANT SELECT, INSERT, UPDATE, DELETE ON "PasswordResetToken" TO sec_app;

-- Unicité du code et du préfixe d'entité par organisation (les références en dépendent)
CREATE UNIQUE INDEX "Entity_organizationId_code_key" ON "Entity"("organizationId", "code");
CREATE UNIQUE INDEX "Entity_organizationId_prefix_key" ON "Entity"("organizationId", "prefix");
