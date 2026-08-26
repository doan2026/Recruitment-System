package com.recruitment.auth.identity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class RefreshSessionTest {
  private static final String FIRST_HASH = "a".repeat(64);
  private static final String SECOND_HASH = "b".repeat(64);

  @Test
  void rotationConsumesParentAndKeepsFamilyLineage() {
    UUID userId = UUID.randomUUID();
    Instant issuedAt = Instant.parse("2026-08-26T10:00:00Z");
    RefreshSession parent = RefreshSession.issue(
        userId, FIRST_HASH, issuedAt, issuedAt.plus(7, ChronoUnit.DAYS));
    Instant rotatedAt = issuedAt.plusSeconds(30);

    RefreshSession child = parent.rotate(
        SECOND_HASH, rotatedAt, rotatedAt.plus(7, ChronoUnit.DAYS));

    assertThat(parent.getConsumedAt()).isEqualTo(rotatedAt);
    assertThat(parent.isUsableAt(rotatedAt.plusSeconds(1))).isFalse();
    assertThat(child.getUserId()).isEqualTo(userId);
    assertThat(child.getFamilyId()).isEqualTo(parent.getFamilyId());
    assertThat(child.getParentSessionId()).isEqualTo(parent.getId());
    assertThat(child.isUsableAt(rotatedAt)).isTrue();
  }

  @Test
  void consumedSessionCannotRotateAgain() {
    Instant issuedAt = Instant.parse("2026-08-26T10:00:00Z");
    RefreshSession session = RefreshSession.issue(
        UUID.randomUUID(), FIRST_HASH, issuedAt, issuedAt.plusSeconds(600));
    session.rotate(SECOND_HASH, issuedAt.plusSeconds(10), issuedAt.plusSeconds(700));

    assertThatThrownBy(() -> session.rotate(
        "c".repeat(64), issuedAt.plusSeconds(20), issuedAt.plusSeconds(800)))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("not usable");
  }

  @Test
  void revokedSessionIsNotUsable() {
    Instant issuedAt = Instant.parse("2026-08-26T10:00:00Z");
    RefreshSession session = RefreshSession.issue(
        UUID.randomUUID(), FIRST_HASH, issuedAt, issuedAt.plusSeconds(600));

    session.revoke(RefreshSessionRevocationReason.LOGOUT, issuedAt.plusSeconds(5));

    assertThat(session.isUsableAt(issuedAt.plusSeconds(6))).isFalse();
    assertThat(session.getRevocationReason()).isEqualTo(RefreshSessionRevocationReason.LOGOUT);
  }

  @Test
  void rejectsRawTokenAndInvalidLifetime() {
    Instant issuedAt = Instant.parse("2026-08-26T10:00:00Z");

    assertThatThrownBy(() -> RefreshSession.issue(
        UUID.randomUUID(), "raw-refresh-token", issuedAt, issuedAt.plusSeconds(60)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> RefreshSession.issue(
        UUID.randomUUID(), FIRST_HASH, issuedAt, issuedAt))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void invalidChildDoesNotConsumeParent() {
    Instant issuedAt = Instant.parse("2026-08-26T10:00:00Z");
    RefreshSession parent = RefreshSession.issue(
        UUID.randomUUID(), FIRST_HASH, issuedAt, issuedAt.plusSeconds(600));

    assertThatThrownBy(() -> parent.rotate(
        "raw-token", issuedAt.plusSeconds(10), issuedAt.plusSeconds(700)))
        .isInstanceOf(IllegalArgumentException.class);

    assertThat(parent.getConsumedAt()).isNull();
    assertThat(parent.isUsableAt(issuedAt.plusSeconds(20))).isTrue();
  }

  @Test
  void rotationRequiresANewTokenHash() {
    Instant issuedAt = Instant.parse("2026-08-26T10:00:00Z");
    RefreshSession parent = RefreshSession.issue(
        UUID.randomUUID(), FIRST_HASH, issuedAt, issuedAt.plusSeconds(600));

    assertThatThrownBy(() -> parent.rotate(
        FIRST_HASH, issuedAt.plusSeconds(10), issuedAt.plusSeconds(700)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("different token hash");
    assertThat(parent.getConsumedAt()).isNull();
  }
}
