import type { ReviewItemStatus } from './reviewItemStatus';
import type { ReviewItemDocType } from './reviewItemDocType';

export interface ReviewItem {
  id: string;
  status: ReviewItemStatus;
  userId: string;
  userEmail: string;
  accountName: string;
  fullName: string;
  dateOfBirth: string;
  idNumberMasked: string;
  docType: ReviewItemDocType;
  idExpiry: string;
  flags: string[];
  rejectReason?: string;
  contentType: string;
  createdAt: string;
}
