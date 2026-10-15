package com.trustpass.api.users;

import com.trustpass.api.shared.CurrentUser;
import com.trustpass.api.shared.PageResponse;
import com.trustpass.api.shared.Role;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.Locale;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
class UserController {

    private final UserService service;
    private final UserRepository users;

    UserController(UserService service, UserRepository users) {
        this.service = service;
        this.users = users;
    }

    @GetMapping("/me")
    UserView getCurrentUser() {
        return UserView.of(service.get(CurrentUser.require().id()));
    }

    @GetMapping("/admin/users")
    @PreAuthorize("hasAnyRole('ADMIN','SUPPORT')")
    PageResponse<UserView> listUsers(@RequestParam(defaultValue = "") String q,
                                @RequestParam(defaultValue = "0") int page,
                                @RequestParam(defaultValue = "25") int size) {
        int safeSize = Math.min(Math.max(size, 1), 100);
        int safePage = Math.max(page, 0);
        var result = users.search(q.trim().toLowerCase(Locale.ROOT),
                PageRequest.of(safePage, safeSize, Sort.by("createdAt").descending()));
        return new PageResponse<>(result.map(UserView::of).getContent(), safePage, safeSize, result.getTotalElements());
    }

    @PatchMapping("/admin/users/{id}/role")
    @PreAuthorize("hasRole('ADMIN')")
    UserView changeUserRole(@PathVariable UUID id, @Valid @RequestBody RoleChange body) {
        return UserView.of(service.changeRole(id, body.role()));
    }

    @PostMapping("/admin/users/{id}/unlock")
    @PreAuthorize("hasAnyRole('ADMIN','SUPPORT')")
    UserView unlockUser(@PathVariable UUID id) {
        return UserView.of(service.unlock(id));
    }

    record RoleChange(@NotNull Role role) {
    }
}
