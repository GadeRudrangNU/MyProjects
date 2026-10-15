
export interface PaymentView {
  id: string;
  kind: string;
  amountCents: number;
  status: string;
  failureReason?: string;
  createdAt: string;
}
