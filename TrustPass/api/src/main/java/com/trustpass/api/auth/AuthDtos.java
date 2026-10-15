package com.trustpass.api.auth;

import com.trustpass.api.users.UserView;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

final class AuthDtos {

    private AuthDtos() {
    }

    record SignupRequest(@NotBlank @Size(max = 120) String name,
                         @NotBlank @Email @Size(max = 254) String email,
                         @NotBlank @StrongPassword String password) {
    }

    record LoginRequest(@NotBlank @Email String email, @NotBlank @Size(max = 128) String password) {
    }

    record MfaVerifyRequest(@NotBlank String mfaToken, @NotBlank @Size(max = 32) String code) {
    }

    record ResendRequest(@NotBlank @Email String email) {
    }

    record LinkRequest(@NotBlank String linkToken, @NotBlank @Size(max = 128) String password) {
    }

    record MessageResponse(String message) {
    }

    record LoginResponse(String status, String accessToken, Long expiresIn, String mfaToken, UserView user) {
    }

    record TokenResponse(String accessToken, long expiresIn) {
    }

    record ProviderView(String id, String name) {
    }
}
