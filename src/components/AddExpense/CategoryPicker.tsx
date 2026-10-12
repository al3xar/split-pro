import { CATEGORIES, type CategoryItem } from '~/lib/category';
import { useMemo } from 'react';
import { useTranslation } from 'next-i18next';

import { Button } from '../ui/button';
import { CategoryIcon } from '../ui/categoryIcons';
import { AppDrawer, AppDrawerClose, DrawerClose } from '../ui/drawer';

export const CategoryPicker: React.FC<{
  category: string;
  onCategoryPick: (category: string) => void;
}> = ({ category, onCategoryPick }) => {
  const { t } = useTranslation('categories');
  const { t: tCommon } = useTranslation();

  const categoryName = useMemo(() => {
    if (category in CATEGORIES) {
      return t(`categories_list.${category}.name`);
    }
    const section = Object.entries(CATEGORIES).find(([, items]) =>
      (items as readonly string[]).includes(category),
    )?.[0];
    return section ? t(`categories_list.${section}.items.${category}`) : category;
  }, [category, t]);

  const trigger = useMemo(
    () => (
      <button
        type="button"
        className="hover:bg-muted flex h-9 max-w-[8.5rem] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 transition-colors"
        aria-label={tCommon('expense_details.add_expense_details.category_label', {
          name: categoryName,
        })}
      >
        <CategoryIcon category={category} size={18} aria-hidden className="shrink-0" />
        <span className="truncate text-xs">{categoryName}</span>
      </button>
    ),
    [category, categoryName, tCommon],
  );

  return (
    <AppDrawer trigger={trigger} title={t('title')} className="h-[70vh]" shouldCloseOnAction>
      {Object.entries(CATEGORIES).map(([categoryName, categoryItems]) => (
        <div key={categoryName} className="mb-8">
          <h3 className="mb-4 text-lg font-semibold">
            {t(`categories_list.${categoryName}.name`)}
          </h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(75px,1fr))] gap-4">
            {categoryItems.map((key: string) => {
              const handleClick = useMemo(
                () => () => {
                  onCategoryPick('other' === key ? categoryName : key);
                },
                [key],
              );

              return (
                <AppDrawerClose key={key} asChild>
                  <Button
                    variant="ghost"
                    className="flex h-[75px] w-[75px] flex-col items-center justify-start gap-1 justify-self-center py-3 text-center"
                    onClick={handleClick}
                  >
                    <span className="block flex-shrink-0 text-2xl">
                      <CategoryIcon
                        category={(key === 'other' ? categoryName : key) as CategoryItem}
                      />
                    </span>
                    <span className="block text-xs text-wrap">
                      {t(`categories_list.${categoryName}.items.${key}`, { ns: 'categories' })}
                    </span>
                  </Button>
                </AppDrawerClose>
              );
            })}
          </div>
        </div>
      ))}
    </AppDrawer>
  );
};
