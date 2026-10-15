package com.recruitment.auth.service.accountcontrol;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.recruitment.auth.dto.account.CurrentAccountResponse;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.model.UserRole;
import com.recruitment.auth.repository.jdbc.AdminUserDirectoryRepository;
import com.recruitment.auth.service.account.CurrentAccountService;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;

class AdminUserDirectoryServiceTest {
  private final AdminUserDirectoryRepository directory = mock(AdminUserDirectoryRepository.class);
  private final CurrentAccountService current = mock(CurrentAccountService.class);
  private final AdminUserDirectoryService service = new AdminUserDirectoryService(directory, current);
  private final UUID id = UUID.randomUUID();

  @Test
  void demotedAdminCannotReadDirectoryEvenWithOldToken() {
    when(current.get(id)).thenReturn(new CurrentAccountResponse(id, "user@example.com", UserRole.CANDIDATE, true));

    assertThatThrownBy(() -> service.list(id, "", null, null, 1, 20))
        .isInstanceOfSatisfying(AuthBusinessException.class, error ->
            org.assertj.core.api.Assertions.assertThat(error.code()).isEqualTo("ACCESS_DENIED"));
    verifyNoInteractions(directory);
  }

  @ParameterizedTest
  @CsvSource({"0,20", "10001,20", "1,0", "1,101"})
  void rejectsUnboundedPaginationBeforeReadingDirectory(int page, int limit) {
    allowAdmin();
    assertThatThrownBy(() -> service.list(id, "", null, null, page, limit))
        .isInstanceOf(AuthBusinessException.class);
    verifyNoInteractions(directory);
  }

  @Test
  void rejectsOversizedEmailBeforeReadingDirectory() {
    allowAdmin();
    assertThatThrownBy(() -> service.list(id, "a".repeat(201), null, null, 1, 20))
        .isInstanceOf(AuthBusinessException.class);
    verifyNoInteractions(directory);
  }

  @Test
  void normalizesLiteralWildcardsAndPreservesFilters() {
    allowAdmin();
    when(directory.findPage(any(), any(), any(), any())).thenReturn(Page.empty());

    service.list(id, " A%b_C! ", UserRole.RECRUITER, true, 2, 20);

    verify(directory).findPage(eq("%a!%b!_c!!%"), eq(UserRole.RECRUITER), eq(true), eq(PageRequest.of(1, 20)));
  }

  private void allowAdmin() {
    when(current.get(id)).thenReturn(new CurrentAccountResponse(id, "admin@example.com", UserRole.ADMIN, true));
  }
}
