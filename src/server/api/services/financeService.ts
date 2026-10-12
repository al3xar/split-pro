import { datePartsInTimeZone, occurrenceDate, pendingOccurrences } from '~/lib/finance';
import { db } from '~/server/db';

/**
 * Creates the entries of every active recurrence whose pay day has arrived and that were
 * not generated yet. Safe to call concurrently: each recurrence claims its months with a
 * conditional update before inserting, so a month is never generated twice. Entries the user
 * deleted are not recreated because `lastGeneratedMonth` only moves forward.
 */
export const materializeRecurrences = async (
  userId: number,
  timeZone: string,
  now = new Date(),
) => {
  const today = datePartsInTimeZone(now, timeZone);
  const recurrences = await db.financeRecurrence.findMany({ where: { userId, active: true } });

  await Promise.all(
    recurrences.map(async (recurrence) => {
      const months = pendingOccurrences(recurrence, today);
      if (0 === months.length) {
        return;
      }
      await db.$transaction(async (tx) => {
        const claimed = await tx.financeRecurrence.updateMany({
          where: { id: recurrence.id, lastGeneratedMonth: recurrence.lastGeneratedMonth },
          data: { lastGeneratedMonth: months.at(-1) },
        });
        if (1 !== claimed.count) {
          return;
        }
        await tx.financeEntry.createMany({
          data: months.map((month) => ({
            userId,
            recurrenceId: recurrence.id,
            type: recurrence.type,
            amount: recurrence.amount,
            currency: recurrence.currency,
            category: recurrence.category,
            description: recurrence.description,
            date: occurrenceDate(month, recurrence.dayOfMonth),
          })),
        });
      });
    }),
  );
};
