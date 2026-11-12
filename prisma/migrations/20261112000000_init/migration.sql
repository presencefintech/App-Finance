-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EntityCode" AS ENUM ('SEC', 'ECOLE');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'CDF');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'CONTROLLER', 'DIRECTOR', 'CASHIER', 'REQUESTER', 'VIEWER');

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "code" "EntityCode" NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEntityRole" (
    "userId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "role" "Role" NOT NULL,

    CONSTRAINT "UserEntityRole_pkey" PRIMARY KEY ("userId","entityId","role")
);

-- CreateIndex
CREATE UNIQUE INDEX "Entity_code_key" ON "Entity"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "UserEntityRole" ADD CONSTRAINT "UserEntityRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEntityRole" ADD CONSTRAINT "UserEntityRole_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

