import React, { useCallback, useId, useMemo, useState } from 'react';

import { cn } from '~/lib/utils';

export interface BarSeries {
  key: string;
  label: string;
  /** CSS color, normally a var(--chart-*) token */
  color: string;
  /** Color for negative values, defaults to `color` */
  negativeColor?: string;
  values: number[];
}

const niceStep = (range: number, targetTicks: number) => {
  if (0 >= range) {
    return 1;
  }
  const rough = range / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const nice = 1.5 > normalized ? 1 : 3 > normalized ? 2 : 7 > normalized ? 5 : 10;
  return nice * magnitude;
};

export const MonthlyBarChart: React.FC<{
  labels: string[];
  /** Accessible full labels, e.g. "October 2026" */
  longLabels: string[];
  series: BarSeries[];
  highlightIndex?: number;
  formatValue: (value: number) => string;
  formatAxis: (value: number) => string;
  height?: number;
}> = ({ labels, longLabels, series, highlightIndex, formatValue, formatAxis, height = 176 }) => {
  const [active, setActive] = useState<number | null>(null);
  const tooltipId = useId();

  const { ticks, lo, hi } = useMemo(() => {
    const all = series.flatMap((s) => s.values);
    const max = Math.max(0, ...all);
    const min = Math.min(0, ...all);
    const step = niceStep(max - min, 4);
    const low = Math.floor(min / step) * step;
    const high = Math.max(Math.ceil(max / step) * step, low + step);
    const tickValues = Array.from(
      { length: Math.round((high - low) / step) + 1 },
      (_, i) => low + i * step,
    );
    return { ticks: tickValues, lo: low, hi: high };
  }, [series]);

  const pct = useCallback((v: number) => ((v - lo) / (hi - lo)) * 100, [lo, hi]);
  const zero = pct(0);

  const describe = useCallback(
    (index: number) =>
      `${longLabels[index]}: ${series.map((s) => `${s.label} ${formatValue(s.values[index] ?? 0)}`).join(', ')}`,
    [longLabels, series, formatValue],
  );

  const clear = useCallback(() => setActive(null), []);

  return (
    <div className="relative select-none" onMouseLeave={clear}>
      <div className="relative ml-12" style={{ height }}>
        {ticks.map((tick) => (
          <div
            key={tick}
            className="absolute right-0 left-0 flex items-center"
            style={{ bottom: `${pct(tick)}%` }}
            aria-hidden
          >
            <span className="text-muted-foreground absolute -left-12 w-10 translate-y-1/2 text-right text-[11px] tabular-nums">
              {formatAxis(tick)}
            </span>
            <div
              className="h-px w-full"
              style={{ background: 0 === tick ? 'var(--chart-axis)' : 'var(--chart-grid)' }}
            />
          </div>
        ))}

        <div
          className="absolute inset-0 grid"
          style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}
        >
          {labels.map((label, index) => (
            <button
              key={longLabels[index]}
              type="button"
              className={cn(
                'relative h-full rounded-md outline-offset-0 transition-colors',
                index === highlightIndex || index === active ? 'bg-[var(--chart-track)]' : '',
              )}
              aria-label={describe(index)}
              aria-describedby={index === active ? tooltipId : undefined}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={clear}
            >
              <span
                className="absolute inset-x-0 flex justify-center gap-[2px]"
                style={{ bottom: 0, top: 0 }}
              >
                {series.map((s) => {
                  const value = s.values[index] ?? 0;
                  const isNegative = 0 > value;
                  const bottom = isNegative ? pct(value) : zero;
                  const barHeight = Math.abs(pct(value) - zero);
                  return (
                    <span key={s.key} className="relative h-full w-full max-w-3">
                      <span
                        className={cn(
                          'absolute inset-x-0',
                          isNegative ? 'rounded-b-[4px]' : 'rounded-t-[4px]',
                        )}
                        style={{
                          bottom: `${bottom}%`,
                          height: `${barHeight}%`,
                          minHeight: 0 === value ? 0 : 2,
                          background: isNegative ? (s.negativeColor ?? s.color) : s.color,
                        }}
                      />
                    </span>
                  );
                })}
              </span>
            </button>
          ))}
        </div>

        {null !== active ? (
          <div
            id={tooltipId}
            role="tooltip"
            className="bg-popover text-popover-foreground pointer-events-none absolute z-10 min-w-36 rounded-lg border px-3 py-2 text-xs shadow-lg"
            style={{
              bottom: '100%',
              left: `${((active + 0.5) / labels.length) * 100}%`,
              transform: `translateX(${active < labels.length / 3 ? '-15%' : active > (labels.length * 2) / 3 ? '-85%' : '-50%'})`,
            }}
          >
            <p className="mb-1 font-medium first-letter:uppercase">{longLabels[active]}</p>
            {series.map((s) => {
              const value = s.values[active] ?? 0;
              return (
                <p key={s.key} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block size-2 rounded-full"
                      style={{ background: 0 > value ? (s.negativeColor ?? s.color) : s.color }}
                      aria-hidden
                    />
                    {s.label}
                  </span>
                  <span className="font-medium tabular-nums">{formatValue(value)}</span>
                </p>
              );
            })}
          </div>
        ) : null}
      </div>

      <div
        className="mt-1 ml-12 grid"
        style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}
        aria-hidden
      >
        {labels.map((label, index) => (
          <span
            key={longLabels[index]}
            className={cn(
              'truncate text-center text-[11px] capitalize',
              index === highlightIndex ? 'text-foreground font-semibold' : 'text-muted-foreground',
            )}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
};

export const ChartLegend: React.FC<{ items: { label: string; color: string }[] }> = ({ items }) => (
  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
    {items.map((item) => (
      <li key={item.label} className="text-muted-foreground flex items-center gap-1.5">
        <span
          className="inline-block size-2.5 rounded-sm"
          style={{ background: item.color }}
          aria-hidden
        />
        {item.label}
      </li>
    ))}
  </ul>
);
