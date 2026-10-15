import type { SubscriptionView } from './subscriptionView';

export interface PaymentResult {
  paymentId: string;
  status: string;
  subscription?: SubscriptionView;
  failureReason?: string;
}
