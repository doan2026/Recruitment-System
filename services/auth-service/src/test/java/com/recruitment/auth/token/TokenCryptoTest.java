package com.recruitment.auth.token;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.recruitment.auth.identity.AuthUser;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

class TokenCryptoTest {
  private static final JOSEObjectType ACCESS_TOKEN_TYPE = JOSEObjectType.JWT;

  @TempDir
  Path tempDirectory;

  @Test
  void refusesImplicitEphemeralKeys() {
    TokenProperties properties = new TokenProperties();

    assertThatThrownBy(() -> RsaTokenKeys.load(
        properties, new DefaultResourceLoader(), new SecureRandom()))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("allow-ephemeral-test-key=true");
  }

  @Test
  void signsExactAccessContractAndDecoderEnforcesAudience() throws Exception {
    TokenProperties properties = ephemeralProperties();
    RsaTokenKeys keys = RsaTokenKeys.load(
        properties, new DefaultResourceLoader(), new SecureRandom());
    JwtTokenService issuer = new JwtTokenService(keys, properties);
    var decoder = new TokenConfiguration().jwtDecoder(keys, properties);
    AuthUser user = AuthUser.registerOAuth(
        "candidate@example.com", Instant.now().minusSeconds(60));
    Instant now = Instant.now().truncatedTo(ChronoUnit.SECONDS);

    JwtTokenService.IssuedAccessToken issued = issuer.issue(user, now);
    SignedJWT serialized = SignedJWT.parse(issued.value());
    var decoded = decoder.decode(issued.value());

    assertThat(serialized.getHeader().getAlgorithm().getName()).isEqualTo("RS256");
    assertThat(serialized.getHeader().getType().getType()).isEqualTo("JWT");
    assertThat(serialized.getHeader().getKeyID()).isEqualTo(keys.activeKeyId());
    assertThat(decoded.getClaims()).containsOnlyKeys(
        "iss", "sub", "aud", "role", "iat", "exp", "jti");
    assertThat(decoded.getSubject()).isEqualTo(user.getId().toString());
    assertThat(decoded.getClaimAsString("role")).isEqualTo("CANDIDATE");
    assertThat(decoded.getAudience()).containsExactly(properties.getAudience());
    assertThat(decoded.getIssuedAt()).isEqualTo(now);
    assertThat(decoded.getExpiresAt()).isEqualTo(now.plusSeconds(900));
    assertThat(decoded.getClaims()).doesNotContainKeys("email", "name", "avatar");
    var interoperableDecoder = NimbusJwtDecoder
        .withPublicKey(keys.publicKey(keys.activeKeyId()))
        .build();
    assertThat(interoperableDecoder.decode(issued.value()).getSubject())
        .isEqualTo(user.getId().toString());

    TokenProperties wrongAudience = ephemeralProperties();
    wrongAudience.setAudience("different-audience");
    var wrongDecoder = new TokenConfiguration().jwtDecoder(keys, wrongAudience);
    assertThatThrownBy(() -> wrongDecoder.decode(issued.value()))
        .isInstanceOf(JwtException.class);
  }

  @Test
  void loadsMatchingPemPublishesPreviousKeyAndNeverPublishesPrivateFields()
      throws Exception {
    KeyPair active = generateRsa(2048);
    KeyPair previous = generateRsa(2048);
    Path privateKey = writePem("active-private.pem", "PRIVATE KEY", active.getPrivate().getEncoded());
    Path publicKey = writePem("active-public.pem", "PUBLIC KEY", active.getPublic().getEncoded());
    Path previousPublic =
        writePem("previous-public.pem", "PUBLIC KEY", previous.getPublic().getEncoded());
    TokenProperties properties = new TokenProperties();
    properties.setPrivateKeyPath(privateKey.toString());
    properties.setPublicKeyPath(publicKey.toString());
    properties.setPreviousPublicKeyPaths(List.of(previousPublic.toString()));

    RsaTokenKeys first = RsaTokenKeys.load(
        properties, new DefaultResourceLoader(), new SecureRandom());
    RsaTokenKeys second = RsaTokenKeys.load(
        properties, new DefaultResourceLoader(), new SecureRandom());
    Map<String, Object> jwks = new JwkSetService(first).publicJwkSet();

    assertThat(first.activeKeyId()).isEqualTo(second.activeKeyId());
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> published = (List<Map<String, Object>>) jwks.get("keys");
    assertThat(published).hasSize(2);
    assertThat(published).allSatisfy(key -> {
      assertThat(key).containsOnlyKeys("kty", "use", "alg", "kid", "n", "e");
      assertThat(key).doesNotContainKeys("d", "p", "q", "dp", "dq", "qi", "oth");
      assertThat(key.get("alg")).isEqualTo("RS256");
    });
  }

  @Test
  void rejectsMismatchedAndWeakRsaKeys() throws Exception {
    KeyPair first = generateRsa(2048);
    KeyPair second = generateRsa(2048);
    TokenProperties mismatch = propertiesFor(
        writePem("first-private.pem", "PRIVATE KEY", first.getPrivate().getEncoded()),
        writePem("second-public.pem", "PUBLIC KEY", second.getPublic().getEncoded()));

    assertThatThrownBy(() -> RsaTokenKeys.load(
        mismatch, new DefaultResourceLoader(), new SecureRandom()))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("do not match");

    KeyPair weak = generateRsa(1024);
    TokenProperties weakProperties = propertiesFor(
        writePem("weak-private.pem", "PRIVATE KEY", weak.getPrivate().getEncoded()),
        writePem("weak-public.pem", "PUBLIC KEY", weak.getPublic().getEncoded()));
    assertThatThrownBy(() -> RsaTokenKeys.load(
        weakProperties, new DefaultResourceLoader(), new SecureRandom()))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("at least 2048 bits");
  }
  @Test
  void decoderRejectsEveryInvalidHeaderAndClaimContract() throws Exception {
    TokenProperties properties = ephemeralProperties();
    RsaTokenKeys keys = RsaTokenKeys.load(
        properties, new DefaultResourceLoader(), new SecureRandom());
    JwtDecoder decoder = new TokenConfiguration().jwtDecoder(keys, properties);
    Instant now = Instant.now().truncatedTo(ChronoUnit.SECONDS);
    Instant issuedAt = now.minusSeconds(60);
    Instant expiresAt = now.plusSeconds(600);
    String subject = UUID.randomUUID().toString();
    String jwtId = UUID.randomUUID().toString();

    assertInvalid(decoder, hmacToken(
        keys.activeKeyId(), properties, subject, "CANDIDATE", issuedAt, expiresAt, jwtId),
        "wrong algorithm");
    assertInvalid(decoder, rsaToken(
        keys,
        keys.activeKeyId(),
        new JOSEObjectType("at+jwt"),
        properties.getIssuer(),
        properties.getAudience(),
        subject,
        "CANDIDATE",
        issuedAt,
        expiresAt,
        jwtId), "wrong typ");
    assertInvalid(decoder, rsaToken(
        keys,
        "unknown-key-id",
        ACCESS_TOKEN_TYPE,
        properties.getIssuer(),
        properties.getAudience(),
        subject,
        "CANDIDATE",
        issuedAt,
        expiresAt,
        jwtId), "unknown kid");
    assertInvalid(decoder, rsaToken(
        keys,
        keys.activeKeyId(),
        ACCESS_TOKEN_TYPE,
        "https://wrong-issuer.test",
        properties.getAudience(),
        subject,
        "CANDIDATE",
        issuedAt,
        expiresAt,
        jwtId), "wrong issuer");
    assertInvalid(decoder, rsaToken(
        keys,
        keys.activeKeyId(),
        ACCESS_TOKEN_TYPE,
        properties.getIssuer(),
        properties.getAudience(),
        subject,
        "CANDIDATE",
        now.minusSeconds(1200),
        now.minusSeconds(600),
        jwtId), "expired token");
    assertInvalid(decoder, rsaToken(
        keys,
        keys.activeKeyId(),
        ACCESS_TOKEN_TYPE,
        properties.getIssuer(),
        properties.getAudience(),
        "not-a-uuid",
        "CANDIDATE",
        issuedAt,
        expiresAt,
        jwtId), "invalid sub");
    assertInvalid(decoder, rsaToken(
        keys,
        keys.activeKeyId(),
        ACCESS_TOKEN_TYPE,
        properties.getIssuer(),
        properties.getAudience(),
        subject,
        "CANDIDATE",
        issuedAt,
        expiresAt,
        "not-a-uuid"), "invalid jti");
    assertInvalid(decoder, rsaToken(
        keys,
        keys.activeKeyId(),
        ACCESS_TOKEN_TYPE,
        properties.getIssuer(),
        properties.getAudience(),
        subject,
        "candidate",
        issuedAt,
        expiresAt,
        jwtId), "invalid role");
  }

  private static void assertInvalid(
      JwtDecoder decoder,
      String token,
      String caseDescription) {
    assertThatThrownBy(() -> decoder.decode(token))
        .as(caseDescription)
        .isInstanceOf(JwtException.class);
  }

  private static String hmacToken(
      String keyId,
      TokenProperties properties,
      String subject,
      String role,
      Instant issuedAt,
      Instant expiresAt,
      String jwtId) throws Exception {
    SignedJWT token = new SignedJWT(
        new JWSHeader.Builder(JWSAlgorithm.HS256)
            .type(ACCESS_TOKEN_TYPE)
            .keyID(keyId)
            .build(),
        claims(
            properties.getIssuer(),
            properties.getAudience(),
            subject,
            role,
            issuedAt,
            expiresAt,
            jwtId));
    token.sign(new MACSigner(new byte[32]));
    return token.serialize();
  }

  private static String rsaToken(
      RsaTokenKeys keys,
      String keyId,
      JOSEObjectType type,
      String issuer,
      String audience,
      String subject,
      String role,
      Instant issuedAt,
      Instant expiresAt,
      String jwtId) throws Exception {
    SignedJWT token = new SignedJWT(
        new JWSHeader.Builder(JWSAlgorithm.RS256)
            .type(type)
            .keyID(keyId)
            .build(),
        claims(issuer, audience, subject, role, issuedAt, expiresAt, jwtId));
    token.sign(new RSASSASigner(keys.activePrivateKey()));
    return token.serialize();
  }

  private static JWTClaimsSet claims(
      String issuer,
      String audience,
      String subject,
      String role,
      Instant issuedAt,
      Instant expiresAt,
      String jwtId) {
    return new JWTClaimsSet.Builder()
        .issuer(issuer)
        .subject(subject)
        .audience(audience)
        .claim("role", role)
        .issueTime(Date.from(issuedAt))
        .expirationTime(Date.from(expiresAt))
        .jwtID(jwtId)
        .build();
  }


  private TokenProperties propertiesFor(Path privateKey, Path publicKey) {
    TokenProperties properties = new TokenProperties();
    properties.setPrivateKeyPath(privateKey.toString());
    properties.setPublicKeyPath(publicKey.toString());
    return properties;
  }

  private static TokenProperties ephemeralProperties() {
    TokenProperties properties = new TokenProperties();
    properties.setIssuer("https://auth.recruitment.test");
    properties.setAudience("recruitment-api");
    properties.setAllowEphemeralTestKey(true);
    return properties;
  }

  private static KeyPair generateRsa(int bits) throws Exception {
    KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
    generator.initialize(bits);
    return generator.generateKeyPair();
  }

  private Path writePem(String filename, String type, byte[] encoded) throws Exception {
    String body = Base64.getMimeEncoder(64, new byte[] {'\n'}).encodeToString(encoded);
    String pem = "-----BEGIN " + type + "-----\n"
        + body + "\n-----END " + type + "-----\n";
    Path destination = tempDirectory.resolve(filename);
    Files.writeString(destination, pem, StandardCharsets.US_ASCII);
    return destination;
  }
}
