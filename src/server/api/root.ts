import { groupRouter } from '~/server/api/routers/group';
import { createTRPCRouter } from '~/server/api/trpc';

import { analyticsRouter } from './routers/analytics';
import { debtsRouter } from './routers/debts';
import { financeRouter } from './routers/finance';
import { householdRouter } from './routers/household';
import { inboxRouter } from './routers/inbox';
import { tricountRouter } from './routers/tricount';
import { userRouter } from './routers/user';
import { bankTransactionsRouter } from './routers/bankTransactions';
import { expenseRouter } from './routers/expense';

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  group: groupRouter,
  user: userRouter,
  bankTransactions: bankTransactionsRouter,
  expense: expenseRouter,
  analytics: analyticsRouter,
  finance: financeRouter,
  debts: debtsRouter,
  household: householdRouter,
  tricount: tricountRouter,
  inbox: inboxRouter,
});

// Export type definition of API
export type AppRouter = typeof appRouter;
