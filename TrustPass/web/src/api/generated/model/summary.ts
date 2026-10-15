import type { DayCount } from './dayCount';
import type { SummaryVerificationsByStatus } from './summaryVerificationsByStatus';
import type { LocationCount } from './locationCount';
import type { SummaryJobsByStatus } from './summaryJobsByStatus';

export interface Summary {
  totalUsers: number;
  activeMemberships: number;
  confirmedBookings: number;
  verificationPassRate: number;
  signupsPerDay: DayCount[];
  failedLoginsPerDay: DayCount[];
  verificationsByStatus: SummaryVerificationsByStatus;
  bookingsPerLocation: LocationCount[];
  jobsByStatus: SummaryJobsByStatus;
}
