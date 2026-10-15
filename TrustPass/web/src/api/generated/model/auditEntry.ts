
export interface AuditEntry {
  id: number;
  at: string;
  actorId?: string;
  actorEmail?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  details: string;
}
