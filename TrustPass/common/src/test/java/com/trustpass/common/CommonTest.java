package com.trustpass.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class CommonTest {

    @Test
    void encryptionRoundTripsAndIsNonDeterministic() {
        FieldCrypto crypto = new FieldCrypto("secret");
        String a = crypto.encrypt("1990-04-02");
        String b = crypto.encrypt("1990-04-02");
        assertThat(a).isNotEqualTo(b).doesNotContain("1990");
        assertThat(crypto.decrypt(a)).isEqualTo("1990-04-02");
        assertThat(crypto.encrypt(null)).isNull();
        assertThat(crypto.decrypt(null)).isNull();
    }

    @Test
    void tamperedOrForeignCiphertextIsRejected() {
        FieldCrypto crypto = new FieldCrypto("secret");
        String encrypted = crypto.encrypt("value");
        assertThatThrownBy(() -> new FieldCrypto("other").decrypt(encrypted)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> crypto.decrypt("not-base64!!")).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void fingerprintsAreStableAndKeyed() {
        FieldCrypto crypto = new FieldCrypto("secret");
        assertThat(crypto.fingerprint("ABC123")).isEqualTo(crypto.fingerprint("ABC123")).hasSize(64);
        assertThat(crypto.fingerprint("ABC123")).isNotEqualTo(new FieldCrypto("other").fingerprint("ABC123"));
    }

    @Test
    void maskingHidesAllButTheEnd() {
        assertThat(Masking.keepLast("A1234567", 4)).isEqualTo("****4567");
        assertThat(Masking.keepLast("123", 4)).isEqualTo("***");
        assertThat(Masking.keepLast(null, 4)).isNull();
        assertThat(Masking.keepLast("", 4)).isEmpty();
        assertThat(Masking.email("jane.doe@example.com")).isEqualTo("j*******@example.com");
        assertThat(Masking.email("a@b.c")).isEqualTo("*@b.c");
        assertThat(Masking.email(null)).isNull();
    }

    @Test
    void backoffGrowsExponentiallyAndGivesUpAfterEightAttempts() {
        assertThat(Backoff.delayAfter(1)).isEqualTo(Duration.ofSeconds(5));
        assertThat(Backoff.delayAfter(2)).isEqualTo(Duration.ofSeconds(10));
        assertThat(Backoff.delayAfter(4)).isEqualTo(Duration.ofSeconds(40));
        assertThat(Backoff.delayAfter(30)).isEqualTo(Duration.ofHours(1));
        assertThat(Backoff.delayAfter(0)).isEqualTo(Duration.ofSeconds(5));
        assertThat(Backoff.exhausted(7)).isFalse();
        assertThat(Backoff.exhausted(8)).isTrue();
    }

    @Test
    void verificationStatesFollowThePipeline() {
        assertThat(VerificationStatus.PENDING.canMoveTo(VerificationStatus.IN_REVIEW)).isTrue();
        assertThat(VerificationStatus.PENDING.canMoveTo(VerificationStatus.VERIFIED)).isFalse();
        assertThat(VerificationStatus.IN_REVIEW.next()).containsExactlyInAnyOrder(VerificationStatus.VERIFIED, VerificationStatus.REJECTED);
        assertThat(VerificationStatus.VERIFIED.next()).isEmpty();
        assertThat(VerificationStatus.REJECTED.canMoveTo(VerificationStatus.PENDING)).isFalse();
    }
}
