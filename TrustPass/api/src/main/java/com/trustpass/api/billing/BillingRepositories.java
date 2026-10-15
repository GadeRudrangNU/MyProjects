package com.trustpass.api.billing;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface PlanRepository extends JpaRepository<Plan, UUID> {

    Optional<Plan> findByCode(String code);
}

interface SubscriptionRepository extends JpaRepository<Subscription, UUID> {

    List<Subscription> findByUserIdOrderByStartedAtDesc(UUID userId);

    Optional<Subscription> findByUserIdAndStatus(UUID userId, String status);

    boolean existsByUserIdAndStatusAndCurrentPeriodEndAfter(UUID userId, String status, Instant now);
}

interface PaymentRepository extends JpaRepository<Payment, UUID> {

    List<Payment> findByUserIdOrderByCreatedAtDesc(UUID userId);
}
