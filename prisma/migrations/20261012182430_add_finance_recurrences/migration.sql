-- AlterTable
ALTER TABLE "FinanceEntry" ADD COLUMN     "recurrenceId" INTEGER;

-- CreateTable
CREATE TABLE "FinanceRecurrence" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "FinanceEntryType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "dayOfMonth" INTEGER NOT NULL,
    "startMonth" TEXT NOT NULL,
    "lastGeneratedMonth" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceRecurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceRecurrence_userId_active_idx" ON "FinanceRecurrence"("userId", "active");

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "FinanceRecurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceRecurrence" ADD CONSTRAINT "FinanceRecurrence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
