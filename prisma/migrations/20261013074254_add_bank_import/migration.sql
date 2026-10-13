-- CreateEnum
CREATE TYPE "ImportedTransactionStatus" AS ENUM ('PENDING', 'SHARED', 'PERSONAL', 'INCOME', 'IGNORED');

-- AlterEnum
ALTER TYPE "FinanceEntryType" ADD VALUE 'EXPENSE';

-- CreateTable
CREATE TABLE "ImportedTransaction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "status" "ImportedTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "category" TEXT,
    "expenseId" UUID,
    "financeEntryId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportedTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionRule" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "pattern" TEXT NOT NULL,
    "action" "ImportedTransactionStatus" NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportedTransaction_userId_status_date_idx" ON "ImportedTransaction"("userId", "status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedTransaction_userId_hash_key" ON "ImportedTransaction"("userId", "hash");

-- CreateIndex
CREATE UNIQUE INDEX "ImportProfile_userId_name_key" ON "ImportProfile"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionRule_userId_pattern_key" ON "TransactionRule"("userId", "pattern");

-- AddForeignKey
ALTER TABLE "ImportedTransaction" ADD CONSTRAINT "ImportedTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportProfile" ADD CONSTRAINT "ImportProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionRule" ADD CONSTRAINT "TransactionRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
