package com.trustpass.api.booking;

import com.trustpass.api.audit.AuditService;
import com.trustpass.api.shared.ApiException;
import com.trustpass.api.shared.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
class BookingController {

    private final BookingService service;
    private final LocationRepository locations;
    private final SlotRepository slots;
    private final BookingRepository bookings;
    private final WaitlistRepository waitlist;
    private final JdbcClient jdbc;
    private final AuditService audit;
    private final Clock clock;

    BookingController(BookingService service, LocationRepository locations, SlotRepository slots,
                      BookingRepository bookings, WaitlistRepository waitlist, JdbcClient jdbc, AuditService audit,
                      Clock clock) {
        this.service = service;
        this.locations = locations;
        this.slots = slots;
        this.bookings = bookings;
        this.waitlist = waitlist;
        this.jdbc = jdbc;
        this.audit = audit;
        this.clock = clock;
    }

    @GetMapping("/locations")
    @Cacheable("locations")
    public List<LocationView> listLocations() {
        return locations.findAllByOrderByNameAsc().stream().map(LocationView::of).toList();
    }

    @PostMapping("/admin/locations")
    @PreAuthorize("hasRole('ADMIN')")
    @CacheEvict(value = "locations", allEntries = true)
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public LocationView createLocation(@Valid @RequestBody LocationRequest body) {
        Location location = new Location();
        location.setName(body.name().trim());
        location.setAddress(body.address().trim());
        locations.saveAndFlush(location);
        audit.record("LOCATION_CREATED", "LOCATION", location.getId().toString(), Map.of("name", location.getName()));
        return LocationView.of(location);
    }

    @PostMapping("/admin/locations/{id}/slots")
    @PreAuthorize("hasRole('ADMIN')")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public SlotView createSlot(@PathVariable UUID id, @Valid @RequestBody SlotRequest body) {
        locations.findById(id).orElseThrow(() -> ApiException.notFound("Location"));
        if (!body.endsAt().isAfter(body.startsAt())) {
            throw ApiException.badRequest("INVALID_RANGE", "The slot must end after it starts");
        }
        Slot slot = new Slot();
        slot.setLocationId(id);
        slot.setStartsAt(body.startsAt());
        slot.setEndsAt(body.endsAt());
        slot.setCapacity(body.capacity());
        slots.saveAndFlush(slot);
        audit.record("SLOT_CREATED", "SLOT", slot.getId().toString(), Map.of("capacity", body.capacity()));
        return SlotView.of(slot, null, false, 0);
    }

    @GetMapping("/locations/{id}/slots")
    @Transactional(readOnly = true)
    public List<SlotView> listSlots(@PathVariable UUID id) {
        UUID me = CurrentUser.require().id();
        locations.findById(id).orElseThrow(() -> ApiException.notFound("Location"));
        List<Slot> list = slots.findByLocationIdAndStartsAtAfterOrderByStartsAtAsc(id, clock.instant());
        List<UUID> ids = list.stream().map(Slot::getId).toList();
        Map<UUID, UUID> mine = bookings.findBySlotIdInAndUserIdAndStatus(ids, me, BookingService.CONFIRMED).stream()
                .collect(Collectors.toMap(Booking::getSlotId, Booking::getId));
        Map<UUID, Integer> waiting = new HashMap<>();
        Map<UUID, Boolean> onList = new HashMap<>();
        for (WaitlistEntry w : waitlist.findBySlotIdInAndStatus(ids, BookingService.WAITING)) {
            waiting.merge(w.getSlotId(), 1, Integer::sum);
            if (w.getUserId().equals(me)) {
                onList.put(w.getSlotId(), true);
            }
        }
        return list.stream().map(s -> SlotView.of(s, mine.get(s.getId()), onList.getOrDefault(s.getId(), false),
                waiting.getOrDefault(s.getId(), 0))).toList();
    }

    @PostMapping("/bookings")
    @ResponseStatus(HttpStatus.CREATED)
    public BookingView createBooking(@Valid @RequestBody BookRequest body) {
        Booking booking = service.book(CurrentUser.require().id(), body.slotId());
        return myBooking(booking.getId());
    }

    @DeleteMapping("/bookings/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void cancelBooking(@PathVariable UUID id) {
        service.cancel(CurrentUser.require(), id);
    }

    @GetMapping("/bookings/me")
    public List<BookingView> listMyBookings() {
        return jdbc.sql(BOOKING_SQL + " where b.user_id = :user order by s.starts_at desc")
                .param("user", CurrentUser.require().id())
                .query(BookingController::mapBooking).list();
    }

    @PostMapping("/slots/{id}/waitlist")
    @ResponseStatus(HttpStatus.CREATED)
    public WaitlistView joinWaitlist(@PathVariable UUID id) {
        service.joinWaitlist(CurrentUser.require().id(), id);
        return new WaitlistView(id, true);
    }

    @DeleteMapping("/slots/{id}/waitlist")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void leaveWaitlist(@PathVariable UUID id) {
        service.leaveWaitlist(CurrentUser.require().id(), id);
    }

    private BookingView myBooking(UUID id) {
        return jdbc.sql(BOOKING_SQL + " where b.id = :id").param("id", id)
                .query(BookingController::mapBooking).single();
    }

    private static final String BOOKING_SQL = """
            select b.id, b.slot_id, l.id as location_id, l.name as location_name, s.starts_at, s.ends_at,
                   b.status, b.created_at, b.user_id
            from bookings b join slots s on s.id = b.slot_id join locations l on l.id = s.location_id
            """;

    private static BookingView mapBooking(java.sql.ResultSet rs, int n) throws java.sql.SQLException {
        return new BookingView(rs.getObject("id", UUID.class), rs.getObject("slot_id", UUID.class),
                rs.getObject("location_id", UUID.class), rs.getString("location_name"),
                rs.getTimestamp("starts_at").toInstant(), rs.getTimestamp("ends_at").toInstant(),
                rs.getString("status"), rs.getTimestamp("created_at").toInstant());
    }

    record LocationRequest(@NotBlank @Size(max = 120) String name, @NotBlank @Size(max = 240) String address) {
    }

    record SlotRequest(@NotNull Instant startsAt, @NotNull Instant endsAt, @Min(1) @Max(500) int capacity) {
    }

    record BookRequest(@NotNull UUID slotId) {
    }

    record LocationView(UUID id, String name, String address) {

        static LocationView of(Location l) {
            return new LocationView(l.getId(), l.getName(), l.getAddress());
        }
    }

    record SlotView(UUID id, UUID locationId, Instant startsAt, Instant endsAt, int capacity, int booked,
                    int available, UUID myBookingId, boolean onWaitlist, int waitlistSize) {

        static SlotView of(Slot s, UUID myBookingId, boolean onWaitlist, int waitlistSize) {
            return new SlotView(s.getId(), s.getLocationId(), s.getStartsAt(), s.getEndsAt(), s.getCapacity(),
                    s.getBookedCount(), s.getCapacity() - s.getBookedCount(), myBookingId, onWaitlist, waitlistSize);
        }
    }

    record BookingView(UUID id, UUID slotId, UUID locationId, String locationName, Instant startsAt, Instant endsAt,
                       String status, Instant createdAt) {
    }

    record WaitlistView(UUID slotId, boolean joined) {
    }
}
