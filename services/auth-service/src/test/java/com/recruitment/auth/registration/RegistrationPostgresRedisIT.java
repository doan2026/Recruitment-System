package com.recruitment.auth.registration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.auth.api.AuthBusinessException;
import com.recruitment.auth.identity.AuthUser;
import com.recruitment.auth.identity.AuthUserRepository;
import com.recruitment.auth.identity.UserRole;
import com.recruitment.auth.registration.api.RegisterRequest;
import com.recruitment.auth.registration.api.RegistrationResponse;
import com.recruitment.auth.registration.api.RegistrationRole;
import com.recruitment.auth.registration.api.VerifyOtpRequest;
import com.recruitment.auth.registration.otp.OtpChallengeCodec;
import com.recruitment.auth.registration.otp.RedisOtpChallengeStore;
import com.recruitment.auth.registration.otp.RedisOtpChallengeStore.ChallengeInspection;
import com.recruitment.auth.registration.otp.RedisOtpChallengeStore.ChallengeState;
import com.recruitment.auth.registration.otp.RedisOtpChallengeStore.TtlState;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@Timeout(30)
class RegistrationPostgresRedisIT {
  private static final String REDIS_PASSWORD = "otp-test-password";
  private static final String OTP_HMAC_SECRET =
      "integration-test-otp-secret-at-least-32-bytes";
  private static final String EMAIL = "candidate@example.com";
  private static final String PASSWORD = "candidate1";
  private static final String OTHER_PASSWORD = "recruiter2";
  private static final String THIRD_PASSWORD = "candidate3";

  @Container
  static final PostgreSQLContainer<?> POSTGRES =
      new PostgreSQLContainer<>("postgres:16-alpine")
          .withDatabaseName("auth_registration_test")
          .withUsername("auth_registration_test")
          .withPassword("auth_registration_test");

  @Container
  static final GenericContainer<?> REDIS =
      new GenericContainer<>(DockerImageName.parse("redis:7-alpine"))
          .withExposedPorts(6379)
          .withCommand("redis-server", "--requirepass", REDIS_PASSWORD);

  @DynamicPropertySource
  static void configureInfrastructure(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
    registry.add("spring.flyway.default-schema", () -> "auth");
    registry.add("spring.flyway.schemas", () -> "auth");
    registry.add("spring.flyway.create-schemas", () -> "true");
    registry.add("spring.jpa.properties.hibernate.default_schema", () -> "auth");
    registry.add("spring.data.redis.url", () ->
        "redis://:" + REDIS_PASSWORD + "@" + REDIS.getHost()
            + ":" + REDIS.getMappedPort(6379));
    registry.add("spring.data.redis.connect-timeout", () -> "2s");
    registry.add("spring.data.redis.timeout", () -> "2s");
    registry.add("auth.otp.hmac-secret", () -> OTP_HMAC_SECRET);
    registry.add("management.health.mail.enabled", () -> "false");
    registry.add("management.endpoint.health.show-details", () -> "always");
  }

  @Autowired
  MockMvc mvc;

  @Autowired
  ObjectMapper objectMapper;

  @Autowired
  JdbcTemplate jdbc;

  @Autowired
  AuthUserRepository users;

  @Autowired
  PasswordEncoder passwordEncoder;

  @Autowired
  RegistrationService registration;

  @Autowired
  RegistrationAccountStore accounts;

  @Autowired
  RegistrationOtpDeliveryService otpDelivery;

  @Autowired
  OtpChallengeCodec codec;

  @Autowired
  RedisOtpChallengeStore otpStore;

  @Autowired
  StringRedisTemplate redis;

  @MockBean
  OtpEmailSender emailSender;

  @BeforeEach
  void cleanState() {
    jdbc.execute("TRUNCATE auth.oauth_accounts, auth.refresh_sessions, auth.users CASCADE");
    redis.execute((RedisCallback<Void>) connection -> {
      connection.serverCommands().flushDb();
      return null;
    });
    reset(emailSender);
    doNothing().when(emailSender).sendRegistrationOtp(anyString(), anyString());
  }

  @Test
  void registrationPersistsBcryptAndOnlyFlowBoundHmacInExpiringPiiFreeKeys()
      throws Exception {
    RegistrationAttempt attempt = registerAttempt(
        "Candidate@Example.COM", PASSWORD, "CANDIDATE", "OTP_REQUIRED");

    AuthUser user = users.findByNormalizedEmail(EMAIL).orElseThrow();
    String emailKey = codec.emailKey(EMAIL);
    String storedChallenge = readyChallenge(emailKey);

    assertThat(users.count()).isEqualTo(1);
    assertThat(user.getEmail()).isEqualTo(EMAIL);
    assertThat(user.getRole()).isEqualTo(UserRole.CANDIDATE);
    assertThat(user.isVerified()).isFalse();
    assertThat(user.getRegistrationId()).isEqualTo(attempt.registrationId());
    assertThat(user.getRegistrationFence()).isPositive();
    assertThat(user.getPasswordHash()).startsWith("$2a$10$");
    assertThat(user.getPasswordHash()).doesNotContain(PASSWORD);
    assertThat(passwordEncoder.matches(PASSWORD, user.getPasswordHash())).isTrue();

    assertThat(storedChallenge)
        .matches("v1\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}")
        .doesNotContain(attempt.code())
        .doesNotContain(EMAIL)
        .doesNotContain(attempt.registrationId().toString());
    assertThat(codec.matchesRegistration(
        storedChallenge,
        user.getId(),
        attempt.registrationId(),
        EMAIL,
        attempt.code())).isTrue();

    RedisOtpChallengeStore.KeyTtl ttl = otpStore.challengeTtl(emailKey);
    assertThat(ttl.state()).isEqualTo(TtlState.EXPIRING);
    assertThat(ttl.remaining()).isBetween(Duration.ofMinutes(4), Duration.ofMinutes(5));

    Set<String> keys = redis.keys("auth:registration:*");
    assertThat(keys).isNotNull().isNotEmpty();
    assertThat(keys).allSatisfy(key ->
        assertThat(key).doesNotContain(EMAIL).doesNotContain("@"));
  }

  @Test
  void correctFlowBoundOtpVerifiesExactlyOnceAndClearsRegistrationIdentity()
      throws Exception {
    RegistrationAttempt attempt = registerAttempt(
        EMAIL, PASSWORD, "CANDIDATE", "OTP_REQUIRED");
    String emailKey = codec.emailKey(EMAIL);

    verifyOtp(EMAIL, attempt.registrationId(), attempt.code())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.email").value(EMAIL))
        .andExpect(jsonPath("$.data.role").value("CANDIDATE"))
        .andExpect(jsonPath("$.data.verified").value(true))
        .andExpect(content().string(not(containsString(attempt.code()))));

    AuthUser verified = users.findByNormalizedEmail(EMAIL).orElseThrow();
    assertThat(verified.isVerified()).isTrue();
    assertThat(verified.getVerifiedAt()).isNotNull();
    assertThat(verified.getRegistrationId()).isNull();
    assertThat(otpStore.inspectChallenge(emailKey).state()).isEqualTo(ChallengeState.MISSING);
    assertThat(otpStore.challengeTtl(emailKey).state()).isEqualTo(TtlState.MISSING);
    assertThat(otpStore.failureTtl(emailKey).state()).isEqualTo(TtlState.MISSING);
    assertThat(otpStore.resendTtl(emailKey).state()).isEqualTo(TtlState.MISSING);

    verifyOtp(EMAIL, attempt.registrationId(), attempt.code())
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("OTP_INVALID_OR_EXPIRED"));
  }

  @Test
  void fifthWrongOtpAndLaterAttemptsAreBlockedForFifteenMinutes() throws Exception {
    RegistrationAttempt attempt = registerAttempt(
        EMAIL, PASSWORD, "CANDIDATE", "OTP_REQUIRED");
    String wrongCode = wrongCode(attempt.code());
    String emailKey = codec.emailKey(EMAIL);

    for (int number = 1; number < 5; number++) {
      verifyOtp(EMAIL, attempt.registrationId(), wrongCode)
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.code").value("OTP_INVALID_OR_EXPIRED"));
    }

    verifyOtp(EMAIL, attempt.registrationId(), wrongCode)
        .andExpect(status().isTooManyRequests())
        .andExpect(header().exists("Retry-After"))
        .andExpect(jsonPath("$.code").value("OTP_VERIFICATION_BLOCKED"));
    verifyOtp(EMAIL, attempt.registrationId(), attempt.code())
        .andExpect(status().isTooManyRequests())
        .andExpect(jsonPath("$.code").value("OTP_VERIFICATION_BLOCKED"));
    resendOtp(EMAIL, attempt.registrationId())
        .andExpect(status().isTooManyRequests())
        .andExpect(jsonPath("$.code").value("OTP_VERIFICATION_BLOCKED"));

    ChallengeInspection blocked = otpStore.inspectChallenge(emailKey);
    assertThat(blocked.state()).isEqualTo(ChallengeState.BLOCKED);
    assertThat(blocked.storedChallenge()).isNull();
    RedisOtpChallengeStore.KeyTtl failureTtl = otpStore.failureTtl(emailKey);
    assertThat(failureTtl.state()).isEqualTo(TtlState.EXPIRING);
    assertThat(failureTtl.remaining())
        .isBetween(Duration.ofMinutes(14), Duration.ofMinutes(15));
    assertThat(users.findByNormalizedEmail(EMAIL).orElseThrow().isVerified()).isFalse();
  }

  @Test
  void rollingLimitAcceptsThreeDispatchesAndRejectedSupersessionCannotMutateAccount()
      throws Exception {
    RegistrationAttempt first = registerAttempt(
        EMAIL, PASSWORD, "CANDIDATE", "OTP_REQUIRED");
    String emailKey = codec.emailKey(EMAIL);
    List<String> challenges = new ArrayList<>();
    challenges.add(readyChallenge(emailKey));

    resendOtp(EMAIL, first.registrationId())
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.data.status").value("OTP_SENT_IF_ELIGIBLE"));
    challenges.add(readyChallenge(emailKey));

    RegistrationAttempt superseded = registerAttempt(
        EMAIL, OTHER_PASSWORD, "RECRUITER", "OTP_RESENT");
    challenges.add(readyChallenge(emailKey));

    String challengeBeforeStaleResend = readyChallenge(emailKey);
    resendOtp(EMAIL, first.registrationId())
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.data.status").value("OTP_SENT_IF_ELIGIBLE"));
    assertThat(readyChallenge(emailKey)).isEqualTo(challengeBeforeStaleResend);
    verify(emailSender, times(3)).sendRegistrationOtp(eq(EMAIL), anyString());

    resendOtp(EMAIL, superseded.registrationId())
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.data.status").value("OTP_SENT_IF_ELIGIBLE"));
    challenges.add(readyChallenge(emailKey));

    AuthUser accepted = users.findByNormalizedEmail(EMAIL).orElseThrow();
    String acceptedHash = accepted.getPasswordHash();
    long acceptedFence = accepted.getRegistrationFence();
    register(EMAIL, THIRD_PASSWORD, "CANDIDATE")
        .andExpect(status().isTooManyRequests())
        .andExpect(header().exists("Retry-After"))
        .andExpect(jsonPath("$.code").value("OTP_RESEND_LIMITED"));

    AuthUser afterLimit = users.findByNormalizedEmail(EMAIL).orElseThrow();
    assertThat(afterLimit.getRegistrationId()).isEqualTo(superseded.registrationId());
    assertThat(afterLimit.getRegistrationFence()).isEqualTo(acceptedFence);
    assertThat(afterLimit.getPasswordHash()).isEqualTo(acceptedHash);
    assertThat(afterLimit.getRole()).isEqualTo(UserRole.RECRUITER);
    assertThat(passwordEncoder.matches(OTHER_PASSWORD, acceptedHash)).isTrue();
    assertThat(passwordEncoder.matches(THIRD_PASSWORD, acceptedHash)).isFalse();

    List<String> codes = sentCodes();
    assertThat(codes).hasSize(4);
    assertThat(challenges).doesNotHaveDuplicates();
    assertThat(otpStore.resendTtl(emailKey).state()).isEqualTo(TtlState.EXPIRING);

    verifyOtp(EMAIL, first.registrationId(), first.code())
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("OTP_INVALID_OR_EXPIRED"));
    verifyOtp(EMAIL, superseded.registrationId(), codes.getLast())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.role").value("RECRUITER"))
        .andExpect(jsonPath("$.data.verified").value(true));
  }

  @Test
  void pendingReregistrationSupersedesAttackerFlowBeforeVictimVerification()
      throws Exception {
    RegistrationAttempt attacker = registerAttempt(
        EMAIL, PASSWORD, "CANDIDATE", "OTP_REQUIRED");
    AuthUser original = users.findByNormalizedEmail(EMAIL).orElseThrow();
    long attackerFence = original.getRegistrationFence();

    RegistrationAttempt victim = registerAttempt(
        "CANDIDATE@EXAMPLE.COM", OTHER_PASSWORD, "RECRUITER", "OTP_RESENT");

    AuthUser pending = users.findByNormalizedEmail(EMAIL).orElseThrow();
    assertThat(users.count()).isEqualTo(1);
    assertThat(pending.getId()).isEqualTo(original.getId());
    assertThat(victim.registrationId()).isNotEqualTo(attacker.registrationId());
    assertThat(pending.getRegistrationId()).isEqualTo(victim.registrationId());
    assertThat(pending.getRegistrationFence()).isGreaterThan(attackerFence);
    assertThat(passwordEncoder.matches(PASSWORD, pending.getPasswordHash())).isFalse();
    assertThat(passwordEncoder.matches(OTHER_PASSWORD, pending.getPasswordHash())).isTrue();
    assertThat(pending.getRole()).isEqualTo(UserRole.RECRUITER);

    verifyOtp(EMAIL, attacker.registrationId(), attacker.code())
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("OTP_INVALID_OR_EXPIRED"));
    resendOtp(EMAIL, attacker.registrationId())
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.data.status").value("OTP_SENT_IF_ELIGIBLE"));
    verify(emailSender, times(2)).sendRegistrationOtp(eq(EMAIL), anyString());
    assertThat(users.findByNormalizedEmail(EMAIL).orElseThrow().isVerified()).isFalse();

    verifyOtp(EMAIL, victim.registrationId(), victim.code())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.role").value("RECRUITER"));
    register(EMAIL, THIRD_PASSWORD, "CANDIDATE")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("EMAIL_ALREADY_REGISTERED"));
    verify(emailSender, times(2)).sendRegistrationOtp(eq(EMAIL), anyString());
  }

  @Test
  void lowerFenceCannotOverwriteNewerPendingRegistration() {
    long initialFence = accounts.nextRegistrationFence();
    long staleFence = accounts.nextRegistrationFence();
    long newerFence = accounts.nextRegistrationFence();

    AuthUser initialDraft = AuthUser.registerLocal(
        EMAIL,
        passwordEncoder.encode(PASSWORD),
        UserRole.CANDIDATE,
        initialFence);
    var initialWrite = accounts.upsertPending(initialDraft);
    assertThat(initialWrite.accepted()).isTrue();
    UUID stableUserId = initialWrite.user().getId();

    AuthUser staleDraft = AuthUser.registerLocal(
        EMAIL,
        passwordEncoder.encode(THIRD_PASSWORD),
        UserRole.CANDIDATE,
        staleFence);
    AuthUser newerDraft = AuthUser.registerLocal(
        EMAIL,
        passwordEncoder.encode(OTHER_PASSWORD),
        UserRole.RECRUITER,
        newerFence);
    var newerWrite = accounts.upsertPending(newerDraft);
    assertThat(newerWrite.accepted()).isTrue();
    assertThat(newerWrite.user().getId()).isEqualTo(stableUserId);

    var rejectedStaleWrite = accounts.upsertPending(staleDraft);
    assertThat(rejectedStaleWrite.accepted()).isFalse();

    AuthUser current = users.findByNormalizedEmail(EMAIL).orElseThrow();
    assertThat(current.getId()).isEqualTo(stableUserId);
    assertThat(current.getRegistrationId()).isEqualTo(newerDraft.getRegistrationId());
    assertThat(current.getRegistrationFence()).isEqualTo(newerFence);
    assertThat(current.getRole()).isEqualTo(UserRole.RECRUITER);
    assertThat(passwordEncoder.matches(OTHER_PASSWORD, current.getPasswordHash())).isTrue();
    assertThat(passwordEncoder.matches(THIRD_PASSWORD, current.getPasswordHash())).isFalse();
  }

  @Test
  void observedAbsentDispatchBindsOtpToActualPersistedUserId() throws Exception {
    long existingFence = accounts.nextRegistrationFence();
    AuthUser existingDraft = AuthUser.registerLocal(
        EMAIL,
        passwordEncoder.encode(PASSWORD),
        UserRole.CANDIDATE,
        existingFence);
    var existingWrite = accounts.upsertPending(existingDraft);
    assertThat(existingWrite.accepted()).isTrue();
    UUID actualPersistedUserId = existingWrite.user().getId();

    long observedAbsentFence = accounts.nextRegistrationFence();
    AuthUser observedAbsentDraft = AuthUser.registerLocal(
        EMAIL,
        passwordEncoder.encode(OTHER_PASSWORD),
        UserRole.RECRUITER,
        observedAbsentFence);
    UUID discardedDraftUserId = observedAbsentDraft.getId();
    UUID registrationId = observedAbsentDraft.getRegistrationId();

    RegistrationOtpDeliveryService.DispatchResult dispatched = otpDelivery.dispatch(
            EMAIL,
            () -> Optional.of(new RegistrationOtpDeliveryService.DispatchPlan(
                registrationId,
                observedAbsentFence,
                false,
                () -> {
                  var write = accounts.upsertPending(observedAbsentDraft);
                  if (!write.accepted()) {
                    throw new IllegalStateException("observed-absent registration was rejected");
                  }
                  return write.user();
                },
                () -> accounts.find(EMAIL).orElseThrow())))
        .orElseThrow();

    String code = latestSentCode();
    String storedChallenge = readyChallenge(codec.emailKey(EMAIL));
    assertThat(dispatched.resend()).isFalse();
    assertThat(dispatched.user().getId()).isEqualTo(actualPersistedUserId);
    assertThat(dispatched.user().getId()).isNotEqualTo(discardedDraftUserId);
    assertThat(dispatched.user().getRegistrationId()).isEqualTo(registrationId);
    assertThat(dispatched.user().getRegistrationFence()).isEqualTo(observedAbsentFence);
    assertThat(codec.matchesRegistration(
        storedChallenge,
        actualPersistedUserId,
        registrationId,
        EMAIL,
        code)).isTrue();
    assertThat(codec.matchesRegistration(
        storedChallenge,
        discardedDraftUserId,
        registrationId,
        EMAIL,
        code)).isFalse();

    verifyOtp(EMAIL, registrationId, code)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.role").value("RECRUITER"));
  }

  @Test
  void concurrentReregistrationCannotMutateCredentialsWhileFirstDispatchIsLeased()
      throws Exception {
    CountDownLatch firstMailStarted = new CountDownLatch(1);
    CountDownLatch releaseFirstMail = new CountDownLatch(1);
    doAnswer(invocation -> {
      firstMailStarted.countDown();
      await(releaseFirstMail);
      return null;
    }).when(emailSender).sendRegistrationOtp(anyString(), anyString());

    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
      Future<RegistrationResponse> first = executor.submit(() -> registration.register(
          new RegisterRequest(EMAIL, PASSWORD, RegistrationRole.CANDIDATE)));
      assertThat(firstMailStarted.await(5, TimeUnit.SECONDS)).isTrue();

      Future<Throwable> duplicate = executor.submit(() -> {
        try {
          registration.register(
              new RegisterRequest(EMAIL, OTHER_PASSWORD, RegistrationRole.RECRUITER));
          return null;
        } catch (Throwable failure) {
          return failure;
        }
      });

      Throwable duplicateFailure = duplicate.get(5, TimeUnit.SECONDS);
      assertThat(duplicateFailure).isInstanceOf(AuthBusinessException.class);
      assertThat(((AuthBusinessException) duplicateFailure).code())
          .isEqualTo("OTP_DISPATCH_IN_PROGRESS");

      AuthUser whileLeased = users.findByNormalizedEmail(EMAIL).orElseThrow();
      assertThat(whileLeased.getRole()).isEqualTo(UserRole.CANDIDATE);
      assertThat(whileLeased.getRegistrationFence()).isPositive();
      assertThat(passwordEncoder.matches(PASSWORD, whileLeased.getPasswordHash())).isTrue();
      assertThat(passwordEncoder.matches(
          OTHER_PASSWORD, whileLeased.getPasswordHash())).isFalse();

      releaseFirstMail.countDown();
      RegistrationResponse firstResponse = first.get(5, TimeUnit.SECONDS);
      assertThat(firstResponse.status()).isEqualTo("OTP_REQUIRED");
      assertThat(firstResponse.registrationId()).isEqualTo(whileLeased.getRegistrationId());

      AuthUser stored = users.findByNormalizedEmail(EMAIL).orElseThrow();
      assertThat(users.count()).isEqualTo(1);
      assertThat(stored.getRegistrationId()).isEqualTo(firstResponse.registrationId());
      assertThat(stored.getRole()).isEqualTo(UserRole.CANDIDATE);
      assertThat(passwordEncoder.matches(PASSWORD, stored.getPasswordHash())).isTrue();
      verify(emailSender, times(1)).sendRegistrationOtp(eq(EMAIL), anyString());
    } finally {
      releaseFirstMail.countDown();
      executor.shutdownNow();
    }
  }

  @Test
  void concurrentCorrectVerificationHasOneWinnerAndOneSafeFailure() throws Exception {
    RegistrationAttempt attempt = registerAttempt(
        EMAIL, PASSWORD, "CANDIDATE", "OTP_REQUIRED");
    CountDownLatch start = new CountDownLatch(1);
    ExecutorService executor = Executors.newFixedThreadPool(2);

    try {
      Future<Integer> first = executor.submit(() -> {
        await(start);
        return verificationOutcome(attempt.registrationId(), attempt.code());
      });
      Future<Integer> second = executor.submit(() -> {
        await(start);
        return verificationOutcome(attempt.registrationId(), attempt.code());
      });
      start.countDown();

      List<Integer> outcomes = List.of(
          first.get(5, TimeUnit.SECONDS),
          second.get(5, TimeUnit.SECONDS));
      assertThat(outcomes.stream().filter(httpStatus -> httpStatus == 200).count()).isEqualTo(1);
      assertThat(outcomes.stream()
          .filter(httpStatus -> httpStatus == 400 || httpStatus == 429)
          .count()).isEqualTo(1);
      AuthUser verified = users.findByNormalizedEmail(EMAIL).orElseThrow();
      assertThat(verified.isVerified()).isTrue();
      assertThat(verified.getRegistrationId()).isNull();
      assertThat(otpStore.inspectChallenge(codec.emailKey(EMAIL)).state())
          .isEqualTo(ChallengeState.MISSING);
    } finally {
      start.countDown();
      executor.shutdownNow();
    }
  }

  @Test
  void smtpFailureLeavesCurrentPendingFlowWithoutChallengeAndRetrySupersedesIt()
      throws Exception {
    doThrow(new IllegalStateException("smtp unavailable"))
        .doNothing()
        .when(emailSender)
        .sendRegistrationOtp(anyString(), anyString());

    register(EMAIL, PASSWORD, "CANDIDATE")
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("OTP_EMAIL_UNAVAILABLE"));

    AuthUser failed = users.findByNormalizedEmail(EMAIL).orElseThrow();
    UUID failedRegistrationId = failed.getRegistrationId();
    long failedFence = failed.getRegistrationFence();
    String emailKey = codec.emailKey(EMAIL);
    assertThat(failed.isVerified()).isFalse();
    assertThat(otpStore.inspectChallenge(emailKey).state()).isEqualTo(ChallengeState.MISSING);
    assertThat(otpStore.resendTtl(emailKey).state()).isEqualTo(TtlState.MISSING);

    RegistrationAttempt recovered = registerAttempt(
        EMAIL, PASSWORD, "CANDIDATE", "OTP_RESENT");
    assertThat(recovered.registrationId()).isNotEqualTo(failedRegistrationId);
    assertThat(users.findByNormalizedEmail(EMAIL).orElseThrow().getRegistrationFence())
        .isGreaterThan(failedFence);
    List<String> codes = sentCodes();
    assertThat(codes).hasSize(2);
    verifyOtp(EMAIL, recovered.registrationId(), recovered.code())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.verified").value(true));
  }

  @Test
  void registrationEndpointsArePublicOtherAuthRoutesDeniedAndHealthUsesRealStores()
      throws Exception {
    redis.opsForValue().set("integration:authenticated", "true");
    assertThat(redis.opsForValue().get("integration:authenticated")).isEqualTo("true");

    mvc.perform(get("/health"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("UP"))
        .andExpect(jsonPath("$.components.db.status").value("UP"))
        .andExpect(jsonPath("$.components.redis.status").value("UP"));
    mvc.perform(get("/auth/health"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("UP"))
        .andExpect(jsonPath("$.components.db.status").value("UP"))
        .andExpect(jsonPath("$.components.redis.status").value("UP"));
    mvc.perform(post("/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{}"))
        .andExpect(status().isForbidden());
    mvc.perform(get("/actuator/info"))
        .andExpect(status().isForbidden());

    registerAttempt(EMAIL, PASSWORD, "RECRUITER", "OTP_REQUIRED");
  }

  private RegistrationAttempt registerAttempt(
      String email,
      String password,
      String role,
      String expectedStatus) throws Exception {
    ResultActions result = register(email, password, role)
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.data.status").value(expectedStatus))
        .andExpect(jsonPath("$.data.expiresInSeconds").value(300))
        .andExpect(jsonPath("$.data.registrationId").isString())
        .andExpect(content().string(not(containsString(password))));
    JsonNode data = objectMapper.readTree(
        result.andReturn().getResponse().getContentAsString()).path("data");
    UUID registrationId = UUID.fromString(data.path("registrationId").asText());
    return new RegistrationAttempt(registrationId, latestSentCode());
  }

  private ResultActions register(
      String email,
      String password,
      String role) throws Exception {
    return postJson("/auth/register", Map.of(
        "email", email,
        "password", password,
        "role", role));
  }

  private ResultActions resendOtp(String email, UUID registrationId) throws Exception {
    return postJson("/auth/otp/resend", Map.of(
        "email", email,
        "registrationId", registrationId));
  }

  private ResultActions verifyOtp(
      String email,
      UUID registrationId,
      String code) throws Exception {
    return postJson("/auth/otp/verify", Map.of(
        "email", email,
        "registrationId", registrationId,
        "otp", code));
  }

  private ResultActions postJson(String path, Map<String, ?> body) throws Exception {
    return mvc.perform(post(path)
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsBytes(body)));
  }

  private String latestSentCode() {
    return sentCodes().getLast();
  }

  private List<String> sentCodes() {
    ArgumentCaptor<String> recipients = ArgumentCaptor.forClass(String.class);
    ArgumentCaptor<String> codes = ArgumentCaptor.forClass(String.class);
    verify(emailSender, atLeastOnce())
        .sendRegistrationOtp(recipients.capture(), codes.capture());
    assertThat(recipients.getAllValues()).allMatch(EMAIL::equals);
    assertThat(codes.getAllValues()).allMatch(code -> code.matches("[0-9]{6}"));
    return List.copyOf(codes.getAllValues());
  }

  private String readyChallenge(String emailKey) {
    ChallengeInspection inspection = otpStore.inspectChallenge(emailKey);
    assertThat(inspection.state()).isEqualTo(ChallengeState.READY);
    assertThat(inspection.storedChallenge()).isNotNull();
    return inspection.storedChallenge();
  }

  private int verificationOutcome(UUID registrationId, String code) {
    try {
      registration.verify(new VerifyOtpRequest(EMAIL, registrationId, code));
      return 200;
    } catch (AuthBusinessException failure) {
      return failure.status().value();
    }
  }

  private static String wrongCode(String correctCode) {
    return "000000".equals(correctCode) ? "999999" : "000000";
  }

  private static void await(CountDownLatch latch) {
    try {
      if (!latch.await(5, TimeUnit.SECONDS)) {
        throw new IllegalStateException("timed out waiting for integration-test latch");
      }
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("integration-test thread was interrupted", interrupted);
    }
  }

  private record RegistrationAttempt(UUID registrationId, String code) {}
}
