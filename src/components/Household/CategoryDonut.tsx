import { useTranslation } from 'next-i18next';
import React, { useMemo } from 'react';

import { type CategorySection } from '~/lib/category';

const SLOTS = [
  'var(--chart-cat-1)',
  'var(--chart-cat-2)',
  'var(--chart-cat-3)',
  'var(--chart-cat-4)',
  'var(--chart-cat-5)',
];
/** Colour of each section, fixed by the household ranking so every donut agrees. */
export const sectionPalette = (ranked: CategorySection[]) =>
  new Map(ranked.slice(0, SLOTS.length).map((section, i) => [section, SLOTS[i]!]));
const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 2;

/**
 * Donut of one person's spending by section. Sections outside the shared palette fold into
 * "Other"; the legend carries every value.
 */
export const CategoryDonut: React.FC<{
  title: string;
  sections: { section: CategorySection; amount: bigint }[];
  palette: Map<CategorySection, string>;
  formatAmount: (amount: bigint) => string;
  formatPercent: (value: number) => string;
}> = ({ title, sections, palette, formatAmount, formatPercent }) => {
  const { t } = useTranslation('categories');
  const { t: tCommon } = useTranslation();

  const slices = useMemo(() => {
    const top = sections.filter((s) => palette.has(s.section));
    const rest = sections
      .filter((s) => !palette.has(s.section))
      .reduce((sum, s) => sum + s.amount, 0n);
    const total = sections.reduce((sum, s) => sum + s.amount, 0n);
    const list = [
      ...top.map((s) => ({
        key: s.section,
        label: t(`categories_list.${s.section}.name`),
        amount: s.amount,
        color: palette.get(s.section)!,
      })),
      ...(0n < rest
        ? [
            {
              key: 'other',
              label: tCommon('household.other'),
              amount: rest,
              color: 'var(--chart-other)',
            },
          ]
        : []),
    ];
    let offset = 0;
    return list.map((slice) => {
      const share = 0n === total ? 0 : Number(slice.amount) / Number(total);
      const length = share * CIRCUMFERENCE;
      const item = { ...slice, share, length, offset };
      offset += length;
      return item;
    });
  }, [sections, palette, t, tCommon]);

  const summary = slices.map((s) => `${s.label} ${formatPercent(s.share)}`).join(', ');

  return (
    <figure className="flex flex-col items-center gap-3">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <svg viewBox="0 0 100 100" className="size-36" role="img" aria-label={`${title}: ${summary}`}>
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke="var(--chart-track)"
          strokeWidth="14"
        />
        {slices.map((slice) => (
          <circle
            key={slice.key}
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke={slice.color}
            strokeWidth="14"
            strokeDasharray={`${Math.max(slice.length - (1 < slices.length ? GAP : 0), 0)} ${CIRCUMFERENCE}`}
            strokeDashoffset={-slice.offset}
            transform="rotate(-90 50 50)"
          />
        ))}
      </svg>
      <ul className="flex w-full flex-col gap-1.5 text-sm">
        {slices.map((slice) => (
          <li key={slice.key} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ background: slice.color }}
                aria-hidden
              />
              <span className="truncate">{slice.label}</span>
            </span>
            <span className="text-muted-foreground shrink-0 tabular-nums">
              {formatAmount(slice.amount)} · {formatPercent(slice.share)}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
};
