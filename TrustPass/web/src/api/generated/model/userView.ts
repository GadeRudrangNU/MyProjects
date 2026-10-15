import type { UserViewRole } from './userViewRole';

export interface UserView {
  id: string;
  email: string;
  name: string;
  role: UserViewRole;
  emailVerified: boolean;
  mfaEnabled: boolean;
  identityVerified: boolean;
  ageOver21: boolean;
  locked: boolean;
  createdAt: string;
}
