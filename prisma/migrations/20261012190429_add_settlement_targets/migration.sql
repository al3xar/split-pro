-- CreateTable
CREATE TABLE "SettlementTarget" (
    "settlementId" UUID NOT NULL,
    "expenseId" UUID NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "SettlementTarget_pkey" PRIMARY KEY ("settlementId","expenseId")
);

-- CreateIndex
CREATE INDEX "SettlementTarget_expenseId_idx" ON "SettlementTarget"("expenseId");

-- AddForeignKey
ALTER TABLE "SettlementTarget" ADD CONSTRAINT "SettlementTarget_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementTarget" ADD CONSTRAINT "SettlementTarget_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
