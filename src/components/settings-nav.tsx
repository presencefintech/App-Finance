import Link from 'next/link';

const TABS = [
  { href: '/parametres/utilisateurs', label: 'Utilisateurs' },
  { href: '/parametres/referentiels', label: 'Catégories et départements' },
  { href: '/parametres/plafonds', label: 'Plafonds et règles' },
  { href: '/audit', label: 'Journal d’audit' },
];

export function SettingsNav({ current }: { current: string }) {
  return (
    <nav className="mb-6 flex flex-wrap gap-2 text-sm">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`rounded-full px-3 py-1 ${t.href === current ? 'bg-primary text-white' : 'border border-border'}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
