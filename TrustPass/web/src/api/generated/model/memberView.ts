import type { MemberViewStatus } from './memberViewStatus';
import type { MemberViewDocType } from './memberViewDocType';

export interface MemberView {
  id: string;
  status: MemberViewStatus;
  docType: MemberViewDocType;
  rejectReason?: string;
  createdAt: string;
  updatedAt: string;
}
