package com.trustpass.api.verification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.trustpass.api.billing.ResilientPaymentGatewayTest;
import org.junit.jupiter.api.Test;

class StorageTest {

    @Test
    void storageRefusesKeysThatEscapeTheUploadFolder() {
        LocalStorageService storage = new LocalStorageService(ResilientPaymentGatewayTest.props(100, 0, 0));
        String key = storage.save(new byte[]{1, 2, 3}, "png");
        assertThat(storage.load(key)).containsExactly(1, 2, 3);
        assertThatThrownBy(() -> storage.load("../../etc/passwd")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> storage.load("..\secret.png")).isInstanceOf(IllegalArgumentException.class);
    }
}
