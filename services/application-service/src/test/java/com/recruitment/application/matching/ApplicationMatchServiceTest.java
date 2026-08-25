package com.recruitment.application.matching;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.AiClient;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.CompanyMemberRole;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationSource;
import com.recruitment.application.repository.ApplicationRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.http.HttpStatus;

class ApplicationMatchServiceTest {
    private static final UUID APPLICATION_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000001"
    );
    private static final UUID COMPANY_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000001"
    );
    private static final UUID OTHER_COMPANY_ID = UUID.fromString(
        "20000000-0000-0000-0000-000000000002"
    );
    private static final UUID RECRUITER_ID = UUID.fromString(
        "30000000-0000-0000-0000-000000000001"
    );
    private static final UUID JOB_ID = UUID.fromString(
        "40000000-0000-0000-0000-000000000001"
    );
    private static final UUID CV_ID = UUID.fromString(
        "50000000-0000-0000-0000-000000000001"
    );
    private static final String AUTHORIZATION = "Bearer recruiter-token";

    private final ApplicationRepository applications =
        mock(ApplicationRepository.class);
    private final CompanyClient companies = mock(CompanyClient.class);
    private final AiClient ai = mock(AiClient.class);
    private final ApplicationMatchScoreWriter writer =
        mock(ApplicationMatchScoreWriter.class);
    private ApplicationMatchService service;

    @BeforeEach
    void setUp() {
        service = new ApplicationMatchService(
            applications,
            companies,
            ai,
            writer
        );
    }

    @ParameterizedTest
    @EnumSource(CompanyMemberRole.class)
    void memberAndOwnerCanRefreshCompanyApplication(
        CompanyMemberRole memberRole
    ) {
        ApplicationEntity application = application();
        BigDecimal score = new BigDecimal("85.46");
        ApplicationMatchScoreResponse stored =
            new ApplicationMatchScoreResponse(APPLICATION_ID, score, 1L);
        when(applications.findById(APPLICATION_ID))
            .thenReturn(Optional.of(application));
        when(companies.getRecruiterMembership(
            RECRUITER_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            COMPANY_ID,
            memberRole
        ));
        when(ai.getMatchScore(CV_ID, JOB_ID)).thenReturn(score);
        when(writer.update(APPLICATION_ID, score, 0L)).thenReturn(stored);

        ApplicationMatchScoreResponse response = service.refresh(
            APPLICATION_ID,
            RECRUITER_ID,
            AUTHORIZATION,
            new RefreshMatchScoreRequest(0L)
        );

        assertThat(response).isEqualTo(stored);
        verify(ai).getMatchScore(CV_ID, JOB_ID);
        verify(writer).update(APPLICATION_ID, score, 0L);
    }

    @Test
    void missingApplicationFailsBeforeDownstreamCalls() {
        when(applications.findById(APPLICATION_ID))
            .thenReturn(Optional.empty());

        assertBusinessError(
            () -> service.refresh(
                APPLICATION_ID,
                RECRUITER_ID,
                AUTHORIZATION,
                new RefreshMatchScoreRequest(0L)
            ),
            "APPLICATION_NOT_FOUND",
            HttpStatus.NOT_FOUND
        );

        verifyNoInteractions(companies, ai, writer);
    }

    @Test
    void outsiderIsDeniedBeforeCallingAi() {
        when(applications.findById(APPLICATION_ID))
            .thenReturn(Optional.of(application()));
        when(companies.getRecruiterMembership(
            RECRUITER_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            OTHER_COMPANY_ID,
            CompanyMemberRole.MEMBER
        ));

        assertBusinessError(
            () -> service.refresh(
                APPLICATION_ID,
                RECRUITER_ID,
                AUTHORIZATION,
                new RefreshMatchScoreRequest(0L)
            ),
            "APPLICATION_ACCESS_DENIED",
            HttpStatus.FORBIDDEN
        );

        verifyNoInteractions(ai, writer);
    }

    @Test
    void staleVersionFailsBeforeCallingAi() {
        when(applications.findById(APPLICATION_ID))
            .thenReturn(Optional.of(application()));
        allowCompanyMember();

        assertBusinessError(
            () -> service.refresh(
                APPLICATION_ID,
                RECRUITER_ID,
                AUTHORIZATION,
                new RefreshMatchScoreRequest(1L)
            ),
            "APPLICATION_CHANGED_CONCURRENTLY",
            HttpStatus.CONFLICT
        );

        verifyNoInteractions(ai, writer);
    }

    @Test
    void aiFailureDoesNotAttemptToOverwriteExistingScore() {
        when(applications.findById(APPLICATION_ID))
            .thenReturn(Optional.of(application()));
        allowCompanyMember();
        when(ai.getMatchScore(CV_ID, JOB_ID)).thenThrow(
            new BusinessException(
                "AI_SERVICE_UNAVAILABLE",
                "Cannot calculate the application match score",
                HttpStatus.SERVICE_UNAVAILABLE
            )
        );

        assertBusinessError(
            () -> service.refresh(
                APPLICATION_ID,
                RECRUITER_ID,
                AUTHORIZATION,
                new RefreshMatchScoreRequest(0L)
            ),
            "AI_SERVICE_UNAVAILABLE",
            HttpStatus.SERVICE_UNAVAILABLE
        );

        verifyNoInteractions(writer);
    }

    @Test
    void concurrentWriteFailureIsPropagatedAfterAiReturns() {
        BigDecimal score = new BigDecimal("91.25");
        when(applications.findById(APPLICATION_ID))
            .thenReturn(Optional.of(application()));
        allowCompanyMember();
        when(ai.getMatchScore(CV_ID, JOB_ID)).thenReturn(score);
        when(writer.update(APPLICATION_ID, score, 0L)).thenThrow(
            new BusinessException(
                "APPLICATION_CHANGED_CONCURRENTLY",
                "Application changed concurrently; reload and try again",
                HttpStatus.CONFLICT
            )
        );

        assertBusinessError(
            () -> service.refresh(
                APPLICATION_ID,
                RECRUITER_ID,
                AUTHORIZATION,
                new RefreshMatchScoreRequest(0L)
            ),
            "APPLICATION_CHANGED_CONCURRENTLY",
            HttpStatus.CONFLICT
        );
    }

    private void allowCompanyMember() {
        when(companies.getRecruiterMembership(
            RECRUITER_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            COMPANY_ID,
            CompanyMemberRole.MEMBER
        ));
    }

    private ApplicationEntity application() {
        return ApplicationEntity.applied(
            APPLICATION_ID,
            JOB_ID,
            COMPANY_ID,
            UUID.randomUUID(),
            RECRUITER_ID,
            CV_ID,
            "Backend Engineer",
            null,
            ApplicationSource.SEARCH,
            Instant.parse("2026-08-25T00:00:00Z")
        );
    }

    private void assertBusinessError(
        org.assertj.core.api.ThrowableAssert.ThrowingCallable call,
        String code,
        HttpStatus status
    ) {
        assertThatThrownBy(call)
            .isInstanceOf(BusinessException.class)
            .satisfies(error -> {
                BusinessException businessError = (BusinessException) error;
                assertThat(businessError.code()).isEqualTo(code);
                assertThat(businessError.status()).isEqualTo(status);
            });
    }
}
