package com.recruitment.auth.token;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class JwkSetService {
  private final Map<String, Object> publicJwkSet;

  JwkSetService(RsaTokenKeys keys) {
    List<Map<String, Object>> publicKeys = keys.publishedPublicJwks().stream()
        .map(jwk -> {
          Map<String, Object> copy = new LinkedHashMap<>(jwk.toJSONObject());
          copy.keySet().retainAll(List.of("kty", "use", "alg", "kid", "n", "e"));
          return Map.copyOf(copy);
        })
        .toList();
    publicJwkSet = Map.of("keys", publicKeys);
  }

  public Map<String, Object> publicJwkSet() {
    return publicJwkSet;
  }
}
