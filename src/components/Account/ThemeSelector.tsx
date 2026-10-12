import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useTheme } from 'next-themes';
import React, { useEffect, useState } from 'react';

import { cn } from '~/lib/utils';

const OPTIONS = [
  { value: 'system', Icon: MonitorIcon },
  { value: 'light', Icon: SunIcon },
  { value: 'dark', Icon: MoonIcon },
] as const;

/** System / Light / Dark switch; the choice is remembered on this device. */
export const ThemeSelector: React.FC = () => {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The stored theme is only known on the client; avoid a hydration mismatch.
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex flex-col gap-2">
      <span id="theme-label" className="text-md">
        {t('account.theme')}
      </span>
      <div
        role="radiogroup"
        aria-labelledby="theme-label"
        className="bg-muted flex rounded-full p-1"
      >
        {OPTIONS.map(({ value, Icon }) => {
          const selected = mounted && (theme ?? 'system') === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(value)}
              className={cn(
                'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full px-3 text-sm transition-colors',
                selected
                  ? 'bg-background text-foreground font-medium shadow-sm'
                  : 'text-muted-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {t(`account.themes.${value}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
};
