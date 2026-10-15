import type { UserView } from './userView';

export interface PageResponseUserView {
  items: UserView[];
  page: number;
  size: number;
  total: number;
}
