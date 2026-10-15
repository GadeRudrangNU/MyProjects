package com.trustpass.api.verification;

import com.trustpass.api.shared.TrustPassProperties;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

@Service
class LocalStorageService implements StorageService {

    private static final Pattern KEY = Pattern.compile("[0-9a-f-]{36}\\.(jpg|png|pdf)");
    private final Path root;

    LocalStorageService(TrustPassProperties props) {
        this.root = Path.of(props.storage().path()).toAbsolutePath().normalize();
    }

    @Override
    public String save(byte[] content, String extension) {
        String key = UUID.randomUUID() + "." + extension;
        try {
            Files.createDirectories(root);
            Files.write(root.resolve(key), content);
            return key;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public byte[] load(String key) {
        if (!KEY.matcher(key).matches()) {
            throw new IllegalArgumentException("invalid storage key");
        }
        try {
            return Files.readAllBytes(root.resolve(key));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
