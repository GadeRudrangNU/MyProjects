package com.trustpass.api.billing;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "plans")
@Getter
@NoArgsConstructor
class Plan {

    @Id
    private UUID id;
    private String code;
    private String name;
    private String description;

    @Column(name = "price_cents")
    private int priceCents;

    @Column(name = "period_days")
    private int periodDays;
}
