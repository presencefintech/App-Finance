'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, FileText, ArrowDownToLine, ArrowUpFromLine, Wallet, Landmark,
  Repeat, PiggyBank, Scale, BarChart3, Settings, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';

const items: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/demandes', label: 'Demandes de fonds', icon: FileText },
  { href: '/recettes', label: 'Recettes', icon: ArrowDownToLine },
  { href: '/depenses', label: 'Dépenses', icon: ArrowUpFromLine },
  { href: '/caisses', label: 'Caisses', icon: Wallet },
  { href: '/banques', label: 'Banques', icon: Landmark },
  { href: '/avances', label: 'Avances', icon: Repeat },
  { href: '/budgets', label: 'Budgets', icon: PiggyBank },
  { href: '/rapprochements', label: 'Rapprochements', icon: Scale },
  { href: '/rapports', label: 'Rapports', icon: BarChart3 },
  { href: '/parametres', label: 'Paramètres', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground md:flex">
      <div className="mb-6 px-2 text-lg font-bold text-white">
        SEC <span className="font-light text-primary-soft">Finance</span>
      </div>
      <nav className="flex flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-sidebar-hover',
                active && 'bg-sidebar-hover font-medium text-white',
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
