-- Imported fixed expenses reopened by the user (no longer covered by the history)
ALTER TABLE "Expense" ADD COLUMN "debtReopenedAt" TIMESTAMP(3);
