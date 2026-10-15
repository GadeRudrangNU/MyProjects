
export interface JobView {
  id: number;
  type: string;
  status: string;
  attempts: number;
  nextRunAt: string;
  lastError?: string;
  traceId?: string;
  createdAt: string;
}
