package com.recruitment.application.interview;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.CompanyMemberRole;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationStatus;
import com.recruitment.application.repository.ApplicationRepository;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

class InterviewSchedulingAuthorizationServiceTest {
    private static final UUID APPLICATION_ID = UUID.randomUUID();
    private static final UUID JOB_ID = UUID.randomUUID();
    private static final UUID COMPANY_ID = UUID.randomUUID();
    private static final UUID CANDIDATE_ID = UUID.randomUUID();
    private static final UUID RECRUITER_ID = UUID.randomUUID();
    private static final String AUTHORIZATION = "Bearer recruiter-token";

    private final ApplicationRepository applications =
        mock(ApplicationRepository.class);
    private final CompanyClient companies = mock(CompanyClient.class);
    private final ApplicationEntity application =
        mock(ApplicationEntity.class);
    private InterviewSchedulingAuthorizationService service;

    @BeforeEach
    void setUp() {
        service = new InterviewSchedulingAuthorizationService(
            applications,
            companies
        );
        when(applications.findByIdAndCompanyId(
            APPLICATION_ID,
            COMPANY_ID
        )).thenReturn(Optional.of(application));
        when(application.getId()).thenReturn(APPLICATION_ID);
        when(application.getJobId()).thenReturn(JOB_ID);
        when(application.getCompanyId()).thenReturn(COMPANY_ID);
        when(application.getCandidateId()).thenReturn(CANDIDATE_ID);
        when(application.getVersion()).thenReturn(7L);
        when(companies.getRecruiterMembership(
            RECRUITER_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            COMPANY_ID,
            CompanyMemberRole.MEMBER
        ));
    }

    @ParameterizedTest
    @MethodSource("schedulableStatuses")
    void returnsOnlyAuthoritativeSchedulingContext(
        ApplicationStatus status
    ) {
        when(application.getStatus()).thenReturn(status);

        InterviewSchedulingContextResponse response = service.authorize(
            APPLICATION_ID,
            RECRUITER_ID,
            AUTHORIZATION
        );

        assertThat(response).isEqualTo(new InterviewSchedulingContextResponse(
            APPLICATION_ID,
            JOB_ID,
            COMPANY_ID,
            CANDIDATE_ID,
            status,
            7L
        ));
        verify(companies).getRecruiterMembership(
            RECRUITER_ID,
            AUTHORIZATION
        );
    }

    @Test
    void missingApplicationIsNotExposedAsAnEmptyContext() {
        when(applications.findByIdAndCompanyId(
            APPLICATION_ID,
            COMPANY_ID
        )).thenReturn(
            Optional.empty()
        );

        assertThatThrownBy(() -> service.authorize(
            APPLICATION_ID,
            RECRUITER_ID,
            AUTHORIZATION
        )).isInstanceOfSatisfying(BusinessException.class, exception -> {
            assertThat(exception.code()).isEqualTo("APPLICATION_NOT_FOUND");
            assertThat(exception.status().value()).isEqualTo(404);
        });
        verify(companies).getRecruiterMembership(
            RECRUITER_ID,
            AUTHORIZATION
        );
    }

    @Test
    void recruiterFromAnotherCompanyCannotEnumerateApplication() {
        when(application.getStatus()).thenReturn(ApplicationStatus.APPLIED);
        UUID otherCompanyId = UUID.randomUUID();
        when(companies.getRecruiterMembership(
            RECRUITER_ID,
            AUTHORIZATION
        )).thenReturn(new RecruiterCompanyMembership(
            otherCompanyId,
            CompanyMemberRole.OWNER
        ));
        when(applications.findByIdAndCompanyId(
            APPLICATION_ID,
            otherCompanyId
        )).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.authorize(
            APPLICATION_ID,
            RECRUITER_ID,
            AUTHORIZATION
        )).isInstanceOfSatisfying(BusinessException.class, exception -> {
            assertThat(exception.code()).isEqualTo(
                "APPLICATION_NOT_FOUND"
            );
            assertThat(exception.status().value()).isEqualTo(404);
        });
    }

    @Test
    void sameCompanyCannotScheduleAnApplicationOutsideInterviewFlow() {
        when(application.getStatus()).thenReturn(ApplicationStatus.APPLIED);

        assertThatThrownBy(() -> service.authorize(
            APPLICATION_ID,
            RECRUITER_ID,
            AUTHORIZATION
        )).isInstanceOfSatisfying(BusinessException.class, exception -> {
            assertThat(exception.code()).isEqualTo(
                "APPLICATION_NOT_SCHEDULABLE"
            );
            assertThat(exception.status().value()).isEqualTo(409);
        });
    }

    static Stream<Arguments> schedulableStatuses() {
        return Stream.of(
            Arguments.of(ApplicationStatus.REVIEWING),
            Arguments.of(ApplicationStatus.INTERVIEW)
        );
    }
}
