import type { UserView } from './userView';

export interface LoginResponse {
  status: string;
  accessToken?: string;
  expiresIn?: number;
  mfaToken?: string;
  user?: UserView;
}
