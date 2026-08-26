package com.recruitment.auth.token;

import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("auth.token")
public class TokenProperties {
  private String issuer = "recruitment-auth";
  private String audience = "recruitment-services";
  private String privateKeyPath;
  private String publicKeyPath;
  private List<String> previousPublicKeyPaths = new ArrayList<>();
  private boolean allowEphemeralTestKey;

  public String getIssuer() {
    return issuer;
  }

  public void setIssuer(String issuer) {
    this.issuer = issuer;
  }

  public String getAudience() {
    return audience;
  }

  public void setAudience(String audience) {
    this.audience = audience;
  }

  public String getPrivateKeyPath() {
    return privateKeyPath;
  }

  public void setPrivateKeyPath(String privateKeyPath) {
    this.privateKeyPath = privateKeyPath;
  }

  public String getPublicKeyPath() {
    return publicKeyPath;
  }

  public void setPublicKeyPath(String publicKeyPath) {
    this.publicKeyPath = publicKeyPath;
  }

  public List<String> getPreviousPublicKeyPaths() {
    return List.copyOf(previousPublicKeyPaths);
  }

  public void setPreviousPublicKeyPaths(List<String> previousPublicKeyPaths) {
    this.previousPublicKeyPaths =
        previousPublicKeyPaths == null ? new ArrayList<>() : new ArrayList<>(previousPublicKeyPaths);
  }

  public boolean isAllowEphemeralTestKey() {
    return allowEphemeralTestKey;
  }

  public void setAllowEphemeralTestKey(boolean allowEphemeralTestKey) {
    this.allowEphemeralTestKey = allowEphemeralTestKey;
  }

  void validateNonKeySettings() {
    issuer = requireText(issuer, "auth.token.issuer");
    audience = requireText(audience, "auth.token.audience");
  }

  private static String requireText(String value, String name) {
    if (value == null || value.isBlank()) {
      throw new IllegalStateException(name + " must not be blank");
    }
    return value.trim();
  }
}
