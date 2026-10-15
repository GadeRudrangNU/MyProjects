import type { JobView } from './jobView';

export interface PageResponseJobView {
  items: JobView[];
  page: number;
  size: number;
  total: number;
}
