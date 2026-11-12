'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, FileText, ArrowDownToLine, ArrowUpFromLine, Wallet, Landmark, Repeat, PiggyBank, Scale,
  BarChart3, Settings, UserRound, ArrowLeftRight, ScrollText, BookOpen, Building2, type LucideIcon,
} from 'lucide-react';
import type { NavIcon } from '@/lib/navigation';
import { cn } from '@/lib/cn';

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard, requests: FileText, income: ArrowDownToLine, expense: ArrowUpFromLine, cash: Wallet,
  bank: Landmark, advances: Repeat, budgets: PiggyBank, reconciliation: Scale, rates: ArrowLeftRight,
  reports: BarChart3, registers: BookOpen, audit: ScrollText, settings: Settings, profile: UserRound, platform: Building2,
};

export interface SidebarItem { href: string; label: string; icon: NavIcon }

const isActive = (pathname: string, href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

/** Menu latéral (≥ md) : n'affiche QUE les entrées autorisées pour les rôles de l'utilisateur. */
export function Sidebar({ items }: { items: SidebarItem[] }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground md:flex">
      <div className="mb-6 px-2 text-lg font-bold text-white">
        SEC <span className="font-light text-primary-soft">Finance</span>
      </div>
      <nav className="flex flex-col gap-1">
        {items.map(({ href, label, icon }) => {
          const Icon = ICONS[icon];
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-sidebar-hover',
                isActive(pathname, href) && 'bg-sidebar-hover font-medium text-white',
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/** Menu mobile (< md) : bandeau défilant, mêmes entrées autorisées. */
export function MobileNav({ items }: { items: SidebarItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigation" className="flex gap-1 overflow-x-auto border-b border-border bg-sidebar px-2 py-2 md:hidden">
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon];
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-sidebar-foreground',
              isActive(pathname, href) && 'bg-sidebar-hover font-medium text-white',
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
