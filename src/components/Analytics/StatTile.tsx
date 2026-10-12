import React from 'react';

import { cn } from '~/lib/utils';

export const StatTile: React.FC<{
  label: string;
  value: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}> = ({ label, value, icon, children, className }) => (
  <section
    className={cn('bg-card flex min-w-0 flex-col gap-1 rounded-xl border p-4', className)}
    aria-label={`${label}: ${value}`}
  >
    <h2 className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
      {icon}
      {label}
    </h2>
    <p className="text-foreground truncate text-2xl font-semibold">{value}</p>
    {children ? <div className="text-muted-foreground text-xs leading-snug">{children}</div> : null}
  </section>
);
