package com.recruitment.application.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "security.jwt")
public class JwtVerificationProperties {
    private String issuer;
    private String audience;
    private String publicKey;
    private String publicKeyPath;
    private String jwksUri;
    private String jwksAllowedHosts;
    private boolean allowInsecureJwks;
    private int jwksTimeoutMs = 3_000;
    private int jwksCacheTtlMs = 300_000;
    private int jwksRefreshCooldownMs = 10_000;

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

    public String getPublicKey() {
        return publicKey;
    }

    public void setPublicKey(String publicKey) {
        this.publicKey = publicKey;
    }

    public String getPublicKeyPath() {
        return publicKeyPath;
    }

    public void setPublicKeyPath(String publicKeyPath) {
        this.publicKeyPath = publicKeyPath;
    }

    public String getJwksUri() {
        return jwksUri;
    }

    public void setJwksUri(String jwksUri) {
        this.jwksUri = jwksUri;
    }

    public String getJwksAllowedHosts() {
        return jwksAllowedHosts;
    }

    public void setJwksAllowedHosts(String jwksAllowedHosts) {
        this.jwksAllowedHosts = jwksAllowedHosts;
    }

    public boolean isAllowInsecureJwks() {
        return allowInsecureJwks;
    }

    public void setAllowInsecureJwks(boolean allowInsecureJwks) {
        this.allowInsecureJwks = allowInsecureJwks;
    }

    public int getJwksTimeoutMs() {
        return jwksTimeoutMs;
    }

    public void setJwksTimeoutMs(int jwksTimeoutMs) {
        this.jwksTimeoutMs = jwksTimeoutMs;
    }

    public int getJwksCacheTtlMs() {
        return jwksCacheTtlMs;
    }

    public void setJwksCacheTtlMs(int jwksCacheTtlMs) {
        this.jwksCacheTtlMs = jwksCacheTtlMs;
    }

    public int getJwksRefreshCooldownMs() {
        return jwksRefreshCooldownMs;
    }

    public void setJwksRefreshCooldownMs(int jwksRefreshCooldownMs) {
        this.jwksRefreshCooldownMs = jwksRefreshCooldownMs;
    }
}
