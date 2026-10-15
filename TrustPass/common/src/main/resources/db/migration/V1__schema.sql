create table users (
    id uuid primary key,
    email varchar(254) not null,
    name varchar(120) not null,
    password_hash varchar(255),
    role varchar(20) not null default 'MEMBER',
    email_verified boolean not null default false,
    mfa_enabled boolean not null default false,
    mfa_secret varchar(512),
    failed_attempts int not null default 0,
    locked_until timestamptz,
    identity_verified boolean not null default false,
    age_over_21 boolean not null default false,
    created_at timestamptz not null default now()
);
create unique index users_email_uq on users (email);

create table email_verification_tokens (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    token_hash varchar(64) not null unique,
    expires_at timestamptz not null,
    used_at timestamptz,
    created_at timestamptz not null default now()
);

create table sessions (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    user_agent varchar(400),
    ip varchar(64),
    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    revoked_at timestamptz
);
create index sessions_user_idx on sessions (user_id);

create table refresh_tokens (
    id uuid primary key,
    session_id uuid not null references sessions (id) on delete cascade,
    token_hash varchar(64) not null unique,
    expires_at timestamptz not null,
    used_at timestamptz,
    created_at timestamptz not null default now()
);
create index refresh_tokens_session_idx on refresh_tokens (session_id);

create table mfa_backup_codes (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    code_hash varchar(64) not null,
    used_at timestamptz,
    created_at timestamptz not null default now()
);
create index mfa_backup_codes_user_idx on mfa_backup_codes (user_id);

create table oauth_identities (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    provider varchar(30) not null,
    subject varchar(200) not null,
    email varchar(254),
    created_at timestamptz not null default now(),
    unique (provider, subject)
);

create table login_events (
    id bigserial primary key,
    email varchar(254),
    ip varchar(64),
    success boolean not null,
    reason varchar(60),
    at timestamptz not null default now()
);
create index login_events_at_idx on login_events (at);

create table plans (
    id uuid primary key,
    code varchar(20) not null unique,
    name varchar(60) not null,
    description varchar(300) not null,
    price_cents int not null,
    period_days int not null
);
insert into plans (id, code, name, description, price_cents, period_days) values
    ('11111111-1111-1111-1111-111111111111', 'BASIC', 'Basic', 'Book up to the standard slots at any location.', 999, 30),
    ('22222222-2222-2222-2222-222222222222', 'PLUS', 'Plus', 'Everything in Basic with priority waitlist handling.', 1999, 30);

create table subscriptions (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    plan_id uuid not null references plans (id),
    status varchar(20) not null,
    started_at timestamptz not null default now(),
    current_period_end timestamptz not null,
    cancelled_at timestamptz
);
create unique index subscriptions_one_active_uq on subscriptions (user_id) where status = 'ACTIVE';

create table payments (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    subscription_id uuid references subscriptions (id),
    plan_id uuid not null references plans (id),
    kind varchar(20) not null,
    amount_cents int not null,
    status varchar(20) not null,
    provider_ref varchar(120),
    failure_reason varchar(200),
    idempotency_key varchar(120) not null,
    created_at timestamptz not null default now()
);
create index payments_user_idx on payments (user_id, created_at desc);

create table idempotency_keys (
    user_id uuid not null references users (id) on delete cascade,
    key varchar(120) not null,
    request_hash varchar(64) not null,
    status varchar(20) not null,
    response_status int,
    response_body text,
    created_at timestamptz not null default now(),
    primary key (user_id, key)
);

create table locations (
    id uuid primary key,
    name varchar(120) not null,
    address varchar(240) not null,
    created_at timestamptz not null default now()
);

create table slots (
    id uuid primary key,
    location_id uuid not null references locations (id) on delete cascade,
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    capacity int not null check (capacity > 0),
    booked_count int not null default 0,
    version bigint not null default 0,
    check (booked_count >= 0 and booked_count <= capacity),
    check (ends_at > starts_at)
);
create index slots_location_idx on slots (location_id, starts_at);

create table bookings (
    id uuid primary key,
    slot_id uuid not null references slots (id) on delete cascade,
    user_id uuid not null references users (id) on delete cascade,
    status varchar(20) not null,
    created_at timestamptz not null default now(),
    cancelled_at timestamptz
);
create unique index bookings_one_confirmed_uq on bookings (slot_id, user_id) where status = 'CONFIRMED';
create index bookings_user_idx on bookings (user_id);

create table waitlist (
    id uuid primary key,
    slot_id uuid not null references slots (id) on delete cascade,
    user_id uuid not null references users (id) on delete cascade,
    status varchar(20) not null,
    created_at timestamptz not null default now()
);
create unique index waitlist_one_waiting_uq on waitlist (slot_id, user_id) where status = 'WAITING';

create table verifications (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    status varchar(20) not null,
    doc_type varchar(30) not null,
    storage_key varchar(200) not null,
    original_filename varchar(255),
    content_type varchar(100) not null,
    file_sha256 varchar(64) not null,
    full_name varchar(160) not null,
    dob_enc text not null,
    id_number_enc text not null,
    id_number_fp varchar(64) not null,
    id_expiry date not null,
    flags jsonb not null default '[]',
    reject_reason varchar(500),
    reviewer_id uuid references users (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    reviewed_at timestamptz
);
create index verifications_status_idx on verifications (status);
create index verifications_hash_idx on verifications (file_sha256);
create index verifications_fp_idx on verifications (id_number_fp);
create unique index verifications_one_open_uq on verifications (user_id) where status in ('PENDING', 'IN_REVIEW');

create table audit_log (
    id bigserial primary key,
    at timestamptz not null default now(),
    actor_id uuid,
    actor_email varchar(254),
    action varchar(60) not null,
    target_type varchar(40),
    target_id varchar(80),
    ip varchar(64),
    details jsonb not null default '{}'
);
create index audit_log_at_idx on audit_log (at desc);

create function audit_log_immutable() returns trigger as $$
begin
    raise exception 'audit_log is append-only';
end;
$$ language plpgsql;

create trigger audit_log_no_update before update or delete on audit_log
    for each row execute function audit_log_immutable();
create trigger audit_log_no_truncate before truncate on audit_log
    for each statement execute function audit_log_immutable();

create table outbox_jobs (
    id bigserial primary key,
    type varchar(40) not null,
    payload jsonb not null default '{}',
    status varchar(10) not null default 'PENDING',
    attempts int not null default 0,
    next_run_at timestamptz not null default now(),
    locked_by varchar(80),
    locked_at timestamptz,
    last_error text,
    trace_id varchar(64),
    created_at timestamptz not null default now(),
    finished_at timestamptz
);
create index outbox_jobs_claim_idx on outbox_jobs (status, next_run_at);

create table rate_limit_buckets (
    id bigint primary key,
    state bytea
);
