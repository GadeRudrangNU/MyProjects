package com.trustpass.api.billing;

interface PaymentProvider {

    record ChargeResult(boolean approved, String providerRef, String failureReason) {
    }

    ChargeResult charge(String reference, int amountCents);

    class ProviderUnavailableException extends RuntimeException {

        ProviderUnavailableException(String message) {
            super(message);
        }

        ProviderUnavailableException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
