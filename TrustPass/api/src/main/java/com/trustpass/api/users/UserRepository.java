package com.trustpass.api.users;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByEmail(String email);

    @Query("""
            select u from User u
            where :q = '' or lower(u.email) like concat('%', :q, '%') or lower(u.name) like concat('%', :q, '%')
            """)
    Page<User> search(@Param("q") String q, Pageable pageable);
}
