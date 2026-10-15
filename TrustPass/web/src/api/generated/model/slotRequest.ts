
export interface SlotRequest {
  startsAt: string;
  endsAt: string;
  /**
   * @minimum 1
   * @maximum 500
   */
  capacity: number;
}
