import { ChevronDownIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useState } from 'react';

import { type CategoryTotals } from '~/lib/analytics';
import { cn } from '~/lib/utils';

import { CategoryIcon } from '../ui/categoryIcons';

const percentOf = (value: bigint, total: bigint) =>
  0n === total ? 0 : Number((value * 10000n) / total) / 100;

const Bar: React.FC<{ value: number; thin?: boolean }> = ({ value, thin }) => (
  <div
    className={cn('w-full overflow-hidden rounded-full', thin ? 'h-1.5' : 'h-2')}
    style={{ background: 'var(--chart-track)' }}
    aria-hidden
  >
    <div
      className="h-full rounded-full"
      style={{ width: `${Math.max(value, 1)}%`, background: 'var(--chart-expense)' }}
    />
  </div>
);

const SectionRow: React.FC<{
  section: CategoryTotals;
  total: bigint;
  max: bigint;
  formatAmount: (amount: bigint) => string;
  formatPercent: (value: number) => string;
}> = ({ section, total, max, formatAmount, formatPercent }) => {
  const { t } = useTranslation('categories');
  const { t: tCommon } = useTranslation();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const name = t(`categories_list.${section.section}.name`);
  const hasDetails = 1 < section.items.length || section.items[0]?.category !== section.section;
  const share = percentOf(section.amount, total);
  const detailsId = `category-details-${section.section}`;

  const header = (
    <>
      <span
        className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-full"
        aria-hidden
      >
        <CategoryIcon category={section.section} size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium">{name}</span>
          <span className="shrink-0 font-semibold tabular-nums">
            {formatAmount(section.amount)}
          </span>
        </span>
        <Bar value={percentOf(section.amount, max)} />
        <span className="text-muted-foreground text-xs">
          {tCommon('analytics.share_of_total', { percent: formatPercent(share / 100) })}
        </span>
      </span>
      {hasDetails ? (
        <ChevronDownIcon
          className={cn(
            'text-muted-foreground size-5 shrink-0 transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      ) : null}
    </>
  );

  return (
    <li>
      {hasDetails ? (
        <button
          type="button"
          className="hover:bg-muted/50 flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors"
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={`${tCommon('analytics.show_details', { name })}: ${formatAmount(section.amount)}`}
          onClick={toggle}
        >
          {header}
        </button>
      ) : (
        <div className="flex items-center gap-3 p-2">{header}</div>
      )}
      {hasDetails && open ? (
        <ul id={detailsId} className="mb-2 ml-[3.25rem] flex flex-col gap-3 py-1 pr-2">
          {section.items.map((item) => {
            const itemKey = item.category === section.section ? 'other' : item.category;
            const itemName = t(`categories_list.${section.section}.items.${itemKey}`);
            return (
              <li key={item.category} className="flex flex-col gap-1">
                <span className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2 truncate">
                    <CategoryIcon
                      category={item.category}
                      size={16}
                      aria-hidden
                      className="text-muted-foreground"
                    />
                    {itemName}
                  </span>
                  <span className="tabular-nums">{formatAmount(item.amount)}</span>
                </span>
                <Bar value={percentOf(item.amount, section.amount)} thin />
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
};

export const CategoryBreakdown: React.FC<{
  categories: CategoryTotals[];
  formatAmount: (amount: bigint) => string;
  formatPercent: (value: number) => string;
}> = ({ categories, formatAmount, formatPercent }) => {
  const total = categories.reduce((sum, c) => sum + c.amount, 0n);
  const max = categories[0]?.amount ?? 0n;

  return (
    <ul className="flex flex-col gap-1">
      {categories.map((section) => (
        <SectionRow
          key={section.section}
          section={section}
          total={total}
          max={max}
          formatAmount={formatAmount}
          formatPercent={formatPercent}
        />
      ))}
    </ul>
  );
};
