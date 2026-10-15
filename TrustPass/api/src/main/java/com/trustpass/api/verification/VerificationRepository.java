package com.trustpass.api.verification;

import com.trustpass.common.VerificationStatus;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface VerificationRepository extends JpaRepository<Verification, UUID> {

    List<Verification> findByUserIdOrderByCreatedAtDesc(UUID userId);

    Page<Verification> findByStatus(VerificationStatus status, Pageable pageable);

    boolean existsByUserIdAndStatusIn(UUID userId, List<VerificationStatus> statuses);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select v from Verification v where v.id = :id")
    Optional<Verification> lockById(@Param("id") UUID id);
}
