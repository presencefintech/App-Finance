import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';

export function Forbidden() {
  return (
    <Card className="mx-auto mt-10 max-w-lg text-center">
      <ShieldAlert className="mx-auto mb-3 size-8 text-muted" />
      <h1 className="text-base font-semibold">Accès non autorisé</h1>
      <p className="mt-1 text-sm text-muted">Votre rôle ne donne pas accès à cette page. Si vous pensez que c’est une erreur, contactez un administrateur.</p>
      <Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">Retour à l’accueil</Link>
    </Card>
  );
}
