import type { AuditEntry } from './auditEntry';

export interface PageResponseAuditEntry {
  items: AuditEntry[];
  page: number;
  size: number;
  total: number;
}
