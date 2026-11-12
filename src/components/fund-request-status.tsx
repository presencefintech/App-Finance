import { StatusBadge } from '@/components/ui/status-badge';
import { FUND_REQUEST_STATUS, type FundRequestStatusKey } from '@/lib/labels';

export function FundRequestStatus({ status }: { status: string }) {
  const s = FUND_REQUEST_STATUS[status as FundRequestStatusKey];
  return <StatusBadge tone={s?.tone ?? 'neutral'}>{s?.label ?? status}</StatusBadge>;
}
