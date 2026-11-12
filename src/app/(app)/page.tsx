import { Card, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';

const kpis = ['Recettes', 'Dépenses', 'Solde caisses', 'Solde banques'];
const entities = ['SEC SARL', 'École'];

export default function DashboardPage() {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardTitle>Recettes et dépenses</CardTitle>
        <p className="py-16 text-center text-sm text-muted">Aucune opération enregistrée pour cette période.</p>
      </Card>

      <Card>
        <CardTitle>Tableau de bord en temps réel</CardTitle>
        <div className="grid grid-cols-2 gap-3">
          {kpis.map((label) => (
            <div key={label} className="rounded-xl border border-border p-3">
              <div className="text-xs text-muted">{label}</div>
              <div className="mt-1 text-2xl font-semibold">—</div>
              <div className="text-xs text-muted">USD · CDF</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Demandes de fonds en attente</CardTitle>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="pb-2">Référence</th>
              <th>Demandeur</th>
              <th>Montant</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={3} className="py-6 text-muted">Aucune demande.</td>
              <td><StatusBadge>—</StatusBadge></td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card>
        <CardTitle>Entités</CardTitle>
        <div className="grid grid-cols-2 gap-3">
          {entities.map((name) => (
            <div key={name} className="rounded-xl border border-border p-4">
              <div className="font-medium">{name}</div>
              <div className="mt-2 text-xs text-muted">Aucun compte configuré</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
