package com.trustpass.api.booking;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "locations")
@Getter
@Setter
@NoArgsConstructor
class Location {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String name;
    private String address;

    @Column(name = "created_at")
    private Instant createdAt = Instant.now();
}

@Entity
@Table(name = "slots")
@Getter
@Setter
@NoArgsConstructor
class Slot {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "location_id")
    private UUID locationId;

    @Column(name = "starts_at")
    private Instant startsAt;

    @Column(name = "ends_at")
    private Instant endsAt;

    private int capacity;

    @Column(name = "booked_count")
    private int bookedCount;

    @Version
    private long version;

    boolean isFull() {
        return bookedCount >= capacity;
    }
}

@Entity
@Table(name = "bookings")
@Getter
@Setter
@NoArgsConstructor
class Booking {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "slot_id")
    private UUID slotId;

    @Column(name = "user_id")
    private UUID userId;

    private String status;

    @Column(name = "created_at")
    private Instant createdAt = Instant.now();

    @Column(name = "cancelled_at")
    private Instant cancelledAt;
}

@Entity
@Table(name = "waitlist")
@Getter
@Setter
@NoArgsConstructor
class WaitlistEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "slot_id")
    private UUID slotId;

    @Column(name = "user_id")
    private UUID userId;

    private String status;

    @Column(name = "created_at")
    private Instant createdAt = Instant.now();
}
