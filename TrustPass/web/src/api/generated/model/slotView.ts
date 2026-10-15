
export interface SlotView {
  id: string;
  locationId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  booked: number;
  available: number;
  myBookingId?: string;
  onWaitlist: boolean;
  waitlistSize: number;
}
