package com.trustpass.api.booking;

import com.trustpass.api.audit.AuditService;
import com.trustpass.api.billing.SubscriptionService;
import com.trustpass.api.notifications.OutboxService;
import com.trustpass.api.shared.ApiException;
import com.trustpass.api.shared.CurrentUser;
import com.trustpass.api.shared.Role;
import com.trustpass.api.users.User;
import com.trustpass.api.users.UserService;
import com.trustpass.common.JobType;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class BookingService {

    static final String CONFIRMED = "CONFIRMED";
    static final String CANCELLED = "CANCELLED";
    static final String WAITING = "WAITING";
    static final String PROMOTED = "PROMOTED";

    private final SlotRepository slots;
    private final BookingRepository bookings;
    private final WaitlistRepository waitlist;
    private final LocationRepository locations;
    private final SubscriptionService membership;
    private final UserService users;
    private final OutboxService outbox;
    private final AuditService audit;
    private final MeterRegistry metrics;
    private final Clock clock;

    BookingService(SlotRepository slots, BookingRepository bookings, WaitlistRepository waitlist,
                   LocationRepository locations, SubscriptionService membership, UserService users,
                   OutboxService outbox, AuditService audit, MeterRegistry metrics, Clock clock) {
        this.slots = slots;
        this.bookings = bookings;
        this.waitlist = waitlist;
        this.locations = locations;
        this.membership = membership;
        this.users = users;
        this.outbox = outbox;
        this.audit = audit;
        this.metrics = metrics;
        this.clock = clock;
    }

    @Transactional
    Booking book(UUID userId, UUID slotId) {
        requireMembership(userId);
        Slot slot = lockOpenSlot(slotId);
        if (bookings.existsBySlotIdAndUserIdAndStatus(slotId, userId, CONFIRMED)) {
            throw ApiException.conflict("ALREADY_BOOKED", "You already have a booking for this slot");
        }
        if (slot.isFull()) {
            throw ApiException.conflict("SLOT_FULL", "This slot is full. You can join the waitlist.");
        }
        waitlist.findBySlotIdAndUserIdAndStatus(slotId, userId, WAITING).ifPresent(w -> w.setStatus("CANCELLED"));
        Booking booking = confirm(slot, userId, true);
        audit.record("BOOKING_CREATED", "BOOKING", booking.getId().toString(), Map.of("slotId", slotId.toString()));
        metrics.counter("trustpass.bookings", "outcome", "confirmed").increment();
        return booking;
    }

    @Transactional
    Booking cancel(CurrentUser actor, UUID bookingId) {
        Booking booking = bookings.findById(bookingId).orElseThrow(() -> ApiException.notFound("Booking"));
        boolean owner = booking.getUserId().equals(actor.id());
        if (!owner && !actor.has(Role.SUPPORT, Role.ADMIN)) {
            throw ApiException.notFound("Booking");
        }
        Slot slot = slots.lockById(booking.getSlotId()).orElseThrow();
        if (!CONFIRMED.equals(booking.getStatus())) {
            throw ApiException.conflict("BOOKING_NOT_ACTIVE", "This booking is already cancelled");
        }
        booking.setStatus(CANCELLED);
        booking.setCancelledAt(clock.instant());
        slot.setBookedCount(slot.getBookedCount() - 1);
        notify(JobType.BOOKING_CANCELLED, booking.getUserId(), slot);
        audit.record("BOOKING_CANCELLED", "BOOKING", bookingId.toString(), Map.of("byOwner", owner));
        metrics.counter("trustpass.bookings", "outcome", "cancelled").increment();
        promoteFromWaitlist(slot);
        return booking;
    }

    @Transactional
    WaitlistEntry joinWaitlist(UUID userId, UUID slotId) {
        requireMembership(userId);
        Slot slot = lockOpenSlot(slotId);
        if (!slot.isFull()) {
            throw ApiException.conflict("SLOT_AVAILABLE", "Spots are available, book the slot instead");
        }
        if (bookings.existsBySlotIdAndUserIdAndStatus(slotId, userId, CONFIRMED)) {
            throw ApiException.conflict("ALREADY_BOOKED", "You already have a booking for this slot");
        }
        if (waitlist.existsBySlotIdAndUserIdAndStatus(slotId, userId, WAITING)) {
            throw ApiException.conflict("ALREADY_WAITLISTED", "You are already on the waitlist");
        }
        WaitlistEntry entry = new WaitlistEntry();
        entry.setSlotId(slotId);
        entry.setUserId(userId);
        entry.setStatus(WAITING);
        waitlist.saveAndFlush(entry);
        notify(JobType.WAITLIST_JOINED, userId, slot);
        return entry;
    }

    @Transactional
    void leaveWaitlist(UUID userId, UUID slotId) {
        WaitlistEntry entry = waitlist.findBySlotIdAndUserIdAndStatus(slotId, userId, WAITING)
                .orElseThrow(() -> ApiException.notFound("Waitlist entry"));
        entry.setStatus(CANCELLED);
    }

    private void promoteFromWaitlist(Slot slot) {
        for (WaitlistEntry entry : waitlist.findBySlotIdAndStatusOrderByCreatedAtAsc(slot.getId(), WAITING)) {
            if (slot.isFull()) {
                return;
            }
            boolean eligible = membership.hasActiveMembership(entry.getUserId())
                    && !bookings.existsBySlotIdAndUserIdAndStatus(slot.getId(), entry.getUserId(), CONFIRMED);
            if (!eligible) {
                entry.setStatus(CANCELLED);
                continue;
            }
            entry.setStatus(PROMOTED);
            Booking booking = confirm(slot, entry.getUserId(), false);
            notify(JobType.WAITLIST_PROMOTED, entry.getUserId(), slot);
            audit.record("WAITLIST_PROMOTED", "BOOKING", booking.getId().toString(),
                    Map.of("userId", entry.getUserId().toString()));
            return;
        }
    }

    private Booking confirm(Slot slot, UUID userId, boolean announce) {
        Booking booking = new Booking();
        booking.setSlotId(slot.getId());
        booking.setUserId(userId);
        booking.setStatus(CONFIRMED);
        bookings.saveAndFlush(booking);
        slot.setBookedCount(slot.getBookedCount() + 1);
        if (announce) {
            notify(JobType.BOOKING_CONFIRMED, userId, slot);
        }
        return booking;
    }

    private void notify(JobType type, UUID userId, Slot slot) {
        User user = users.get(userId);
        Location location = locations.findById(slot.getLocationId()).orElseThrow();
        outbox.enqueue(type, Map.of(
                "email", user.getEmail(),
                "name", user.getName(),
                "location", location.getName(),
                "startsAt", slot.getStartsAt().toString()));
    }

    private Slot lockOpenSlot(UUID slotId) {
        Slot slot = slots.lockById(slotId).orElseThrow(() -> ApiException.notFound("Slot"));
        if (!slot.getStartsAt().isAfter(clock.instant())) {
            throw ApiException.badRequest("SLOT_IN_PAST", "This slot has already started");
        }
        return slot;
    }

    private void requireMembership(UUID userId) {
        if (!membership.hasActiveMembership(userId)) {
            throw ApiException.forbidden("MEMBERSHIP_REQUIRED", "An active membership is required to book");
        }
    }

}
