import { AccountDetail } from '@/components/account-detail';

export default async function CaisseDetail({ params }: { params: Promise<{ id: string }> }) {
  return <AccountDetail id={(await params).id} />;
}
