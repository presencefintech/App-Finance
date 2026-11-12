import { AccountDetail } from '@/components/account-detail';

export default async function BanqueDetail({ params }: { params: Promise<{ id: string }> }) {
  return <AccountDetail id={(await params).id} />;
}
