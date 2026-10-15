package com.trustpass.worker;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class VerificationChecksTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 6, 1);

    private List<String> run(String account, String document, LocalDate dob, LocalDate expiry, boolean duplicate) {
        return VerificationChecks.evaluate(account, document, dob, expiry, TODAY, duplicate);
    }

    @Test
    void cleanDocumentRaisesNoFlags() {
        assertThat(run("Jane Doe", "Jane Doe", LocalDate.of(1990, 1, 1), LocalDate.of(2030, 1, 1), false)).isEmpty();
    }

    @Test
    void flagsEveryProblemIndependently() {
        assertThat(run("Jane Doe", "Jane Doe", LocalDate.of(1990, 1, 1), LocalDate.of(2026, 5, 31), false)).containsExactly("EXPIRED_DOCUMENT");
        assertThat(run("Jane Doe", "John Smith", LocalDate.of(1990, 1, 1), LocalDate.of(2030, 1, 1), false)).containsExactly("NAME_MISMATCH");
        assertThat(run("Jane Doe", "Jane Doe", LocalDate.of(2010, 1, 1), LocalDate.of(2030, 1, 1), false)).containsExactly("UNDERAGE");
        assertThat(run("Jane Doe", "Jane Doe", LocalDate.of(1990, 1, 1), LocalDate.of(2030, 1, 1), true)).containsExactly("DUPLICATE_DOCUMENT");
        assertThat(run("Jane Doe", "Someone Else", LocalDate.of(2012, 1, 1), LocalDate.of(2020, 1, 1), true))
                .containsExactly("EXPIRED_DOCUMENT", "NAME_MISMATCH", "UNDERAGE", "DUPLICATE_DOCUMENT");
    }

    @Test
    void expiryOnTheDayItselfIsStillValid() {
        assertThat(run("Jane Doe", "Jane Doe", LocalDate.of(1990, 1, 1), TODAY, false)).isEmpty();
    }

    @Test
    void ageBoundaryIsExactlyEighteen() {
        assertThat(run("A B", "A B", TODAY.minusYears(18), TODAY.plusYears(1), false)).isEmpty();
        assertThat(run("A B", "A B", TODAY.minusYears(18).plusDays(1), TODAY.plusYears(1), false)).containsExactly("UNDERAGE");
    }

    @Test
    void nameComparisonIgnoresCaseAccentsOrderAndMiddleNames() {
        assertThat(VerificationChecks.namesMatch("José Álvarez", "jose alvarez")).isTrue();
        assertThat(VerificationChecks.namesMatch("Doe, Jane", "Jane Doe")).isTrue();
        assertThat(VerificationChecks.namesMatch("Jane Doe", "Jane Marie Doe")).isTrue();
        assertThat(VerificationChecks.namesMatch("Jane Doe", "Jane Roe")).isFalse();
        assertThat(VerificationChecks.namesMatch("", "Jane")).isFalse();
        assertThat(VerificationChecks.namesMatch(null, "Jane")).isFalse();
    }
}
