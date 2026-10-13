import { SparklesIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import React from 'react';

import { api } from '~/utils/api';

/** Floating "ask" button, shown only when the assistant is configured. */
export const AssistantFab: React.FC = () => {
  const { t } = useTranslation();
  const enabledQuery = api.assistant.enabled.useQuery(undefined, { staleTime: 5 * 60_000 });
  if (!enabledQuery.data) {
    return null;
  }
  return (
    <Link
      href="/assistant"
      aria-label={t('assistant.title')}
      className="bg-secondary text-secondary-foreground fixed right-4 bottom-42 z-40 flex size-12 items-center justify-center rounded-full border shadow-lg transition-transform hover:scale-105 lg:bottom-26"
    >
      <SparklesIcon className="size-5" aria-hidden />
    </Link>
  );
};
