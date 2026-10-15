package com.recruitment.auth.service.account;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

import com.recruitment.auth.dto.account.RecruiterContactRequest;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.model.AuthUser;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.repository.jpa.AuthUserRepository;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class CurrentAccountServiceTest {
  private final AuthUserRepository users = mock(AuthUserRepository.class);
  private final CurrentAccountService service = new CurrentAccountService(users);

  @Test
  void recruiterContactIsNormalizedAndSavedWithoutExposingOtherIdentityData() {
    AuthUser user = active(UserRole.RECRUITER);
    var response = service.updateRecruiterContact(user.getId(), new RecruiterContactRequest("  Nguyễn An  ", "0901234567"));
    assertThat(response.fullName()).isEqualTo("Nguyễn An");
    assertThat(service.getRecruiterContact(user.getId()).phone()).isEqualTo("0901234567");
    assertThat(response.toString()).doesNotContain("Nguyễn An", "0901234567");
    verify(users).saveAndFlush(user);
  }

  @Test
  void rejectsCandidateAndLockedRecruiterBeforeWriting() {
    AuthUser candidate = active(UserRole.CANDIDATE);
    assertThatThrownBy(() -> service.updateRecruiterContact(candidate.getId(), new RecruiterContactRequest("Candidate", "0901234567")))
        .isInstanceOf(AuthBusinessException.class).hasMessageContaining("Recruiter access");
    AuthUser recruiter = active(UserRole.RECRUITER);
    recruiter.lock("Test lock", Instant.now());
    assertThatThrownBy(() -> service.getRecruiterContact(recruiter.getId()))
        .isInstanceOf(AuthBusinessException.class).hasMessageContaining("locked");
    verify(users, never()).saveAndFlush(any());
  }

  @Test
  void serviceAlsoRejectsMalformedContactWithoutRelyingOnControllerValidation() {
    AuthUser user = active(UserRole.RECRUITER);
    assertThatThrownBy(() -> service.updateRecruiterContact(user.getId(), new RecruiterContactRequest("Recruiter", "++++++")))
        .isInstanceOf(AuthBusinessException.class);
    verify(users, never()).saveAndFlush(any());
  }

  private AuthUser active(UserRole role) {
    AuthUser user = AuthUser.registerOAuth("contact@example.com", role, Instant.now());
    when(users.findById(user.getId())).thenReturn(Optional.of(user));
    return user;
  }
}
