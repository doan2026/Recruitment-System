package com.recruitment.interview.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;

class JwtConfigurationTest {
  private static final Instant NOW = Instant.parse("2026-08-28T05:00:00Z");
  private static final String ISSUER = "https://auth.recruitment.local";
  private static final String AUDIENCE = "recruitment-api";
  private static RSAPrivateKey privateKey;
  private static RSAPublicKey publicKey;
  private static String keyId;
  private static JwtDecoder decoder;

  @BeforeAll
  static void createDecoder() throws Exception {
    KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
    generator.initialize(2048);
    KeyPair pair = generator.generateKeyPair();
    privateKey = (RSAPrivateKey) pair.getPrivate();
    publicKey = (RSAPublicKey) pair.getPublic();
    keyId = JwtConfiguration.keyId(publicKey);
    decoder = new JwtConfiguration().jwtDecoder(
        publicKey,
        new InterviewJwtProperties("unused-in-this-test", ISSUER, AUDIENCE),
        Clock.fixed(NOW, ZoneOffset.UTC));
  }

  @Test
  void decodesStrictValidRecruiterToken() throws Exception {
    var jwt = decoder.decode(token(TokenOverrides.valid()));

    assertThat(jwt.getIssuer()).hasToString(ISSUER);
    assertThat(jwt.getAudience()).containsExactly(AUDIENCE);
    assertThat(jwt.getClaimAsString("role")).isEqualTo("RECRUITER");
    assertThat(jwt.getHeaders()).containsEntry("kid", keyId);
  }

  @Test
  void rejectsWrongTypeKeyAndIssuer() throws Exception {
    assertThatThrownBy(() -> decoder.decode(token(
        TokenOverrides.valid(), JWSAlgorithm.PS256)))
        .isInstanceOf(JwtException.class);
    assertRejected(TokenOverrides.valid().withType(new JOSEObjectType("at+jwt")));
    assertRejected(TokenOverrides.valid().withKeyId("unknown-key"));
    assertRejected(TokenOverrides.valid().withIssuer("https://wrong.example"));
  }

  @Test
  void rejectsNonExactAudienceAndNonStringRole() throws Exception {
    assertRejected(TokenOverrides.valid().withAudiences(List.of(AUDIENCE, "other-api")));
    assertRejected(TokenOverrides.valid().withAudiences(List.of("other-api")));
    assertRejected(TokenOverrides.valid().withRole(List.of("RECRUITER")));
    assertRejected(TokenOverrides.valid().withRole("recruiter"));
  }

  @Test
  void rejectsMissingOrNonVersionFourIdentityClaims() throws Exception {
    assertRejected(TokenOverrides.valid().withSubject(UUID.randomUUID().toString().toUpperCase()));
    assertRejected(TokenOverrides.valid().withSubject("1d8f1ef1-8bbc-11db-9fe1-0800200c9a66"));
    assertRejected(TokenOverrides.valid().withoutJwtId());
  }

  @Test
  void rejectsInvalidTemporalContract() throws Exception {
    assertRejected(TokenOverrides.valid().withIssuedAt(NOW.plusSeconds(61)));
    assertRejected(TokenOverrides.valid().withExpiresAt(NOW.minusSeconds(61)));
    assertRejected(TokenOverrides.valid()
        .withIssuedAt(NOW.minusSeconds(60))
        .withExpiresAt(NOW.minusSeconds(60)));
  }

  private static void assertRejected(TokenOverrides overrides) throws Exception {
    String serialized = token(overrides);
    assertThatThrownBy(() -> decoder.decode(serialized)).isInstanceOf(JwtException.class);
  }

  private static String token(TokenOverrides overrides) throws Exception {
    return token(overrides, JWSAlgorithm.RS256);
  }

  private static String token(
      TokenOverrides overrides,
      JWSAlgorithm algorithm
  ) throws Exception {
    JWTClaimsSet.Builder claims = new JWTClaimsSet.Builder()
        .issuer(overrides.issuer)
        .audience(overrides.audiences)
        .subject(overrides.subject)
        .issueTime(Date.from(overrides.issuedAt))
        .expirationTime(Date.from(overrides.expiresAt))
        .claim("role", overrides.role);
    if (overrides.jwtId != null) {
      claims.jwtID(overrides.jwtId);
    }
    SignedJWT signed = new SignedJWT(
        new JWSHeader.Builder(algorithm)
            .type(overrides.type)
            .keyID(overrides.keyId)
            .build(),
        claims.build());
    signed.sign(new RSASSASigner(privateKey));
    return signed.serialize();
  }

  private record TokenOverrides(
      JOSEObjectType type,
      String keyId,
      String issuer,
      List<String> audiences,
      String subject,
      String jwtId,
      Object role,
      Instant issuedAt,
      Instant expiresAt
  ) {
    static TokenOverrides valid() {
      return new TokenOverrides(
          JOSEObjectType.JWT,
          JwtConfigurationTest.keyId,
          ISSUER,
          List.of(AUDIENCE),
          UUID.randomUUID().toString(),
          UUID.randomUUID().toString(),
          "RECRUITER",
          NOW.minusSeconds(10),
          NOW.plusSeconds(900));
    }

    TokenOverrides withType(JOSEObjectType value) {
      return new TokenOverrides(value, keyId, issuer, audiences, subject, jwtId, role,
          issuedAt, expiresAt);
    }

    TokenOverrides withKeyId(String value) {
      return new TokenOverrides(type, value, issuer, audiences, subject, jwtId, role,
          issuedAt, expiresAt);
    }

    TokenOverrides withIssuer(String value) {
      return new TokenOverrides(type, keyId, value, audiences, subject, jwtId, role,
          issuedAt, expiresAt);
    }

    TokenOverrides withAudiences(List<String> value) {
      return new TokenOverrides(type, keyId, issuer, value, subject, jwtId, role,
          issuedAt, expiresAt);
    }

    TokenOverrides withSubject(String value) {
      return new TokenOverrides(type, keyId, issuer, audiences, value, jwtId, role,
          issuedAt, expiresAt);
    }

    TokenOverrides withoutJwtId() {
      return new TokenOverrides(type, keyId, issuer, audiences, subject, null, role,
          issuedAt, expiresAt);
    }

    TokenOverrides withRole(Object value) {
      return new TokenOverrides(type, keyId, issuer, audiences, subject, jwtId, value,
          issuedAt, expiresAt);
    }

    TokenOverrides withIssuedAt(Instant value) {
      return new TokenOverrides(type, keyId, issuer, audiences, subject, jwtId, role,
          value, expiresAt);
    }

    TokenOverrides withExpiresAt(Instant value) {
      return new TokenOverrides(type, keyId, issuer, audiences, subject, jwtId, role,
          issuedAt, value);
    }
  }
}
