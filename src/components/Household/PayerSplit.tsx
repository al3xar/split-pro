import React from 'react';

/** People use colours outside the category palette so they never read as a category. */
const PERSON_COLORS = ['var(--primary)', 'var(--chart-other)', 'var(--muted-foreground)'];

/** One bar split by how much each member paid, with names, amounts and shares below. */
export const PayerSplit: React.FC<{
  payers: { name: string; amount: bigint }[];
  formatAmount: (amount: bigint) => string;
  formatPercent: (value: number) => string;
}> = ({ payers, formatAmount, formatPercent }) => {
  const total = payers.reduce((sum, p) => sum + p.amount, 0n);
  if (0n === total) {
    return null;
  }
  const rows = payers.map((p, i) => ({
    ...p,
    share: Number(p.amount) / Number(total),
    color: PERSON_COLORS[i % PERSON_COLORS.length]!,
  }));

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full"
        role="img"
        aria-label={rows.map((r) => `${r.name} ${formatPercent(r.share)}`).join(', ')}
      >
        {rows.map((r) => (
          <div
            key={r.name}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${r.share * 100}%`, background: r.color }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap justify-between gap-x-6 gap-y-2 text-sm">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: r.color }}
              aria-hidden
            />
            <span className="font-medium">{r.name}</span>
            <span className="text-muted-foreground tabular-nums">
              {formatAmount(r.amount)} · {formatPercent(r.share)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
