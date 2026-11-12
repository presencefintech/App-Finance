import { redirect } from 'next/navigation';
import { Forbidden } from '@/components/forbidden';
import { canAccessPath } from '@/lib/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { can } from '@/lib/permissions';
import { getCurrentUser } from '@/server/auth';
import { getSelectedEntities } from '@/server/entity-selection';
import { defaultRange, type RegisterType } from '@/server/modules/registers/service';

const REGISTERS: { type: RegisterType; label: string; hint: string }[] = [
  { type: 'entrees', label: 'Entrées', hint: 'Recettes encaissées' },
  { type: 'sorties', label: 'Sorties', hint: 'Dépenses et décaissements' },
  { type: 'demandes', label: 'Demandes de fonds', hint: 'Toutes les demandes de la période' },
  { type: 'retraits', label: 'Retraits bancaires', hint: 'En transit, confirmés, annulés' },
  { type: 'versements', label: 'Versements bancaires', hint: 'Caisse vers banque' },
  { type: 'avances', label: 'Avances', hint: 'Créances et dettes inter-entités' },
  { type: 'remboursements', label: 'Remboursements', hint: 'Remboursements d’avances' },
  { type: 'journalier', label: 'Journal journalier', hint: 'Toutes les écritures du jour' },
  { type: 'mensuel', label: 'Journal mensuel', hint: 'Toutes les écritures du mois' },
];
const dayInput = (d: Date) => new Date(d.getTime() + 2 * 3600_000).toISOString().slice(0, 10);

export default async function RegistresPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccessPath('/registres', user.roles)) return <Forbidden />;
  const sp = await searchParams;
  const { entities } = await getSelectedEntities(user);
  const readable = entities.filter((e) => can(user.roles, 'account.read', e.id));
  if (readable.length === 0) return <Card>Vous n’avez pas accès aux registres.</Card>;
  const base = defaultRange('entrees');
  const from = sp.from ?? dayInput(base.from);
  const to = sp.to ?? dayInput(base.to);

  return (
    <div className="grid gap-6">
      <Card>
        <CardTitle>Registres imprimables</CardTitle>
        <p className="mb-4 text-sm text-muted">
          Le papier reste : imprimez le registre, faites-le signer, puis photographiez-le et rattachez la photo à l’opération.
          Chaque document comporte l’en-tête de l’entité, les montants en chiffres et en lettres et les cases de signature.
        </p>
        <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
          <label>Du<input type="date" name="from" defaultValue={from} className="ml-2 rounded-lg border border-border px-3 py-1.5" /></label>
          <label>Au<input type="date" name="to" defaultValue={to} className="ml-2 rounded-lg border border-border px-3 py-1.5" /></label>
          <button className="rounded-lg border border-border px-4 py-2 hover:bg-background">Appliquer la période</button>
        </form>
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {REGISTERS.map((r) => (
          <Card key={r.type}>
            <h3 className="font-medium">{r.label}</h3>
            <p className="mb-3 text-xs text-muted">{r.hint}</p>
            {readable.map((e) => (
              <div key={e.id} className="mb-2 flex items-center justify-between gap-2 text-sm">
                <span>{e.name}</span>
                <span className="flex gap-2">
                  <a className="rounded-lg bg-primary px-3 py-1 text-white" href={`/api/v1/registers/${r.type}?entity=${e.code}&from=${from}&to=${to}&format=pdf`}>PDF</a>
                  <a className="rounded-lg border border-border px-3 py-1 hover:bg-background" href={`/api/v1/registers/${r.type}?entity=${e.code}&from=${from}&to=${to}&format=xlsx`}>Excel</a>
                </span>
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}
