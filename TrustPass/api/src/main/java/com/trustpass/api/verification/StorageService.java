package com.trustpass.api.verification;

public interface StorageService {

    String save(byte[] content, String extension);

    byte[] load(String key);
}
