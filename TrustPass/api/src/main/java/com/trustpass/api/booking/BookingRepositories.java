package com.trustpass.api.booking;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface LocationRepository extends JpaRepository<Location, UUID> {

    List<Location> findAllByOrderByNameAsc();
}

interface SlotRepository extends JpaRepository<Slot, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Slot s where s.id = :id")
    Optional<Slot> lockById(@Param("id") UUID id);

    List<Slot> findByLocationIdAndStartsAtAfterOrderByStartsAtAsc(UUID locationId, Instant after);
}

interface BookingRepository extends JpaRepository<Booking, UUID> {

    boolean existsBySlotIdAndUserIdAndStatus(UUID slotId, UUID userId, String status);

    List<Booking> findBySlotIdInAndUserIdAndStatus(List<UUID> slotIds, UUID userId, String status);
}

interface WaitlistRepository extends JpaRepository<WaitlistEntry, UUID> {

    boolean existsBySlotIdAndUserIdAndStatus(UUID slotId, UUID userId, String status);

    Optional<WaitlistEntry> findBySlotIdAndUserIdAndStatus(UUID slotId, UUID userId, String status);

    List<WaitlistEntry> findBySlotIdAndStatusOrderByCreatedAtAsc(UUID slotId, String status);

    List<WaitlistEntry> findBySlotIdInAndStatus(List<UUID> slotIds, String status);
}
