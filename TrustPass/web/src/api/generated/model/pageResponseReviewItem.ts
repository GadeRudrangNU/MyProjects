import type { ReviewItem } from './reviewItem';

export interface PageResponseReviewItem {
  items: ReviewItem[];
  page: number;
  size: number;
  total: number;
}
