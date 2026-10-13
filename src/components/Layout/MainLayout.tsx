import {
  PresentationChartBarIcon as SolidAnalyticsIcon,
  HomeIcon as SolidHomeIcon,
  ListBulletIcon as SolidListBulletIcon,
  PlusCircleIcon as SolidPlusCircleIcon,
  ChartPieIcon as SolidScaleIcon,
  UserCircleIcon as SolidUserCircleIcon,
  UserGroupIcon as SolidUserGroupIcon,
} from '@heroicons/react/24/solid';
import { clsx } from 'clsx';
import { type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { useAddExpenseDialog } from '~/store/addExpenseDialogStore';

import { LoadingSpinner } from '../ui/spinner';

interface MainLayoutProps {
  title?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  header?: React.ReactNode;
  loading?: boolean;
  hideAppBar?: boolean;
}

const MainLayout: React.FC<MainLayoutProps> = ({
  children,
  actions,
  hideAppBar,
  title,
  loading,
}) => {
  const { t } = useTranslation();
  const router = useRouter();
  const currentPath = router.pathname;
  const openWith = useAddExpenseDialog((s) => s.openWith);
  const openAddDialog = React.useCallback(() => openWith(), [openWith]);

  return (
    <div className="bg-background h-full w-full">
      <div
        vaul-drawer-wrapper=""
        className={clsx(
          'bg-background mx-auto flex h-full w-full flex-col lg:max-w-3xl lg:flex-row',
          hideAppBar ? '' : '',
        )}
      >
        <nav
          aria-label={t?.('meta.application_name') ?? 'SplitPro'}
          className="item-center -ml-[170px] hidden w-[170px] px-4 py-4 lg:flex lg:flex-col lg:gap-2"
        >
          <Link href="/balances" className="mb-8 flex items-center gap-2">
            <span className="text-xl font-medium">
              {t?.('meta.application_name') ?? 'SplitPro'}
            </span>
          </Link>
          <NavItemDesktop
            title={t?.('navigation.household') ?? 'Household'}
            Icon={SolidHomeIcon}
            link="/household"
            currentPath={currentPath}
          />
          <NavItemDesktop
            title={t?.('navigation.balances') ?? 'Balances'}
            Icon={SolidScaleIcon}
            link="/balances"
            currentPath={currentPath}
          />
          <NavItemDesktop
            title={t?.('navigation.groups') ?? 'Groups'}
            Icon={SolidUserGroupIcon}
            link="/groups"
            currentPath={currentPath}
          />
          <NavItemDesktop
            title={t?.('navigation.add_expense') ?? 'Add Expense'}
            Icon={SolidPlusCircleIcon}
            link="/add"
            onClick={openAddDialog}
            currentPath={currentPath}
          />
          <NavItemDesktop
            title={t?.('navigation.analytics') ?? 'Analytics'}
            Icon={SolidAnalyticsIcon}
            link="/analytics"
            currentPath={currentPath}
          />
          <NavItemDesktop
            title={t?.('navigation.activity') ?? 'Activity'}
            Icon={SolidListBulletIcon}
            link="/activity"
            currentPath={currentPath}
          />
          <NavItemDesktop
            title={t?.('navigation.account') ?? 'Account'}
            Icon={SolidUserCircleIcon}
            link="/account"
            currentPath={currentPath}
          />
        </nav>
        <div className="lg:border-border w-full overflow-auto lg:border-x lg:px-6" id="mainlayout">
          {title ? (
            <div className="mb-2 flex items-center justify-between px-4 py-4">
              {'string' === typeof title ? (
                <h1 className="text-foreground text-3xl font-bold">{title}</h1>
              ) : (
                <div className="text-foreground text-3xl font-bold">{title}</div>
              )}
              {actions}
            </div>
          ) : null}
          <div className="px-4">
            {loading ? (
              <div className="mt-10 flex justify-center">
                <LoadingSpinner className="text-primary" />
              </div>
            ) : (
              children
            )}
          </div>
          <div className="h-28 lg:h-0" />
        </div>
      </div>

      <nav
        aria-label={t?.('meta.application_name') ?? 'SplitPro'}
        className="bg-background/80 fixed bottom-0 flex w-full justify-between border-t px-1 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xs backdrop-blur-lg lg:hidden"
      >
        <NavItem
          title={t?.('navigation.household') ?? 'Household'}
          Icon={SolidHomeIcon}
          link="/household"
          currentPath={currentPath}
        />
        <NavItem
          title={t?.('navigation.balances') ?? 'Balances'}
          Icon={SolidScaleIcon}
          link="/balances"
          currentPath={currentPath}
        />
        <NavItem
          title={t?.('navigation.groups') ?? 'Groups'}
          Icon={SolidUserGroupIcon}
          link="/groups"
          currentPath={currentPath}
        />
        <NavItem
          title={t?.('navigation.add') ?? 'Add'}
          Icon={SolidPlusCircleIcon}
          link="/add"
          onClick={openAddDialog}
          currentPath={currentPath}
        />
        <NavItem
          title={t?.('navigation.analytics') ?? 'Analytics'}
          Icon={SolidAnalyticsIcon}
          link="/analytics"
          currentPath={currentPath}
        />
        <NavItem
          title={t?.('navigation.account') ?? 'Account'}
          Icon={SolidUserCircleIcon}
          link="/account"
          currentPath={currentPath}
        />
      </nav>
    </div>
  );
};

interface NavItemProps {
  title: string;
  Icon: LucideIcon;
  link: string;
  currentPath?: string;
  /** Renders a button (e.g. open the add dialog) instead of a link */
  onClick?: () => void;
}

const isActiveLink = (link: string, currentPath?: string) =>
  currentPath === link ||
  (currentPath?.startsWith(`${link}/`) ?? false) ||
  ('/analytics' === link && '/finances' === currentPath);

const NavItem: React.FC<NavItemProps> = ({ title, Icon, link, currentPath, onClick }) => {
  const isActive = isActiveLink(link, currentPath);
  const Element = onClick ? 'button' : Link;

  return (
    <Element
      href={link}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={clsx(
        'flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-0.5 pt-3 pb-1',
        isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-6 shrink-0" aria-hidden />
      <span
        className={clsx('w-full truncate text-center text-[11px]', isActive && 'font-semibold')}
      >
        {title}
      </span>
    </Element>
  );
};

const NavItemDesktop: React.FC<NavItemProps> = ({ title, Icon, link, currentPath, onClick }) => {
  const isActive = isActiveLink(link, currentPath);
  const Element = onClick ? 'button' : Link;

  return (
    <Element
      href={link}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={clsx(
        'flex w-[150px] items-center gap-2 rounded-lg px-2 py-3 transition-colors',
        isActive ? 'text-primary font-semibold' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-6 shrink-0" aria-hidden />
      <span className="capitalize">{title}</span>
    </Element>
  );
};
export default MainLayout;
