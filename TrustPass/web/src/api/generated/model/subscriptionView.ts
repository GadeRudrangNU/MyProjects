
export interface SubscriptionView {
  id: string;
  planCode: string;
  planName: string;
  status: string;
  startedAt: string;
  currentPeriodEnd: string;
  cancelledAt?: string;
}
