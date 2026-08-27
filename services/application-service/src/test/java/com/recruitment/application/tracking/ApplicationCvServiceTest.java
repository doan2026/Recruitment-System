package com.recruitment.application.tracking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.CompanyMemberRole;
import com.recruitment.application.client.ProfileClient;
import com.recruitment.application.client.ProfileClient.CvDownloadUrl;
import com.recruitment.application.client.ProfileClient.ProfileCv;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationEntity;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.http.HttpStatus;

class ApplicationCvServiceTest {
    private static final UUID APPLICATION_ID = UUID.randomUUID();
    private static final UUID RECRUITER_ID = UUID.randomUUID();
    private static final UUID COMPANY_ID = UUID.randomUUID();
    private static final UUID CANDIDATE_ID = UUID.randomUUID();
    private static final UUID CV_ID = UUID.randomUUID();
    private static final UUID FILE_ID = UUID.randomUUID();
    private static final String AUTHORIZATION = "Bearer recruiter-token";
    private static final Instant CREATED_AT = Instant.parse(
        "2026-08-27T08:00:00Z"
    );

    private final ApplicationTrackingRepository applications =
        mock(ApplicationTrackingRepository.class);
    private final CompanyClient companies = mock(CompanyClient.class);
    private final ProfileClient profiles = mock(ProfileClient.class);
    private ApplicationCvService service;

    @BeforeEach
    void setUp() {
        service = new ApplicationCvService(applications, companies, profiles);
        when(companies.getRecruiterMembership(RECRUITER_ID, AUTHORIZATION))
            .thenReturn(new RecruiterCompanyMembership(
                COMPANY_ID,
                CompanyMemberRole.MEMBER
            ));
    }

    @Test
    void authorizesCompanyBeforeLoadingApplicationAndProfileCv() {
        ApplicationEntity application = application();
        when(applications.findByIdAndCompanyId(APPLICATION_ID, COMPANY_ID))
            .thenReturn(Optional.of(application));
        when(profiles.getCandidateCv(CANDIDATE_ID, CV_ID))
            .thenReturn(profileCv(true));

        ApplicationCvResponse response = service.getCv(
            APPLICATION_ID,
            RECRUITER_ID,
            AUTHORIZATION
        );

        assertThat(response.cvId()).isEqualTo(CV_ID);
        assertThat(response.title()).isEqualTo("Backend CV");
        assertThat(response.isDeleted()).isTrue();
        InOrder order = inOrder(companies, applications, profiles);
        order.verify(companies).getRecruiterMembership(
            RECRUITER_ID,
            AUTHORIZATION
        );
        order.verify(applications).findByIdAndCompanyId(
            APPLICATION_ID,
            COMPANY_ID
        );
        order.verify(profiles).getCandidateCv(CANDIDATE_ID, CV_ID);
    }

    @Test
    void createsDownloadUsingOnlyIdsStoredOnApplication() {
        when(applications.findByIdAndCompanyId(APPLICATION_ID, COMPANY_ID))
            .thenReturn(Optional.of(application()));
        when(profiles.createCandidateCvDownloadUrl(CANDIDATE_ID, CV_ID))
            .thenReturn(new CvDownloadUrl(
                CANDIDATE_ID,
                CV_ID,
                "https://media.example/private.pdf?token=short",
                CREATED_AT.plusSeconds(300)
            ));

        ApplicationCvDownloadResponse response = service.createDownloadUrl(
            APPLICATION_ID,
            RECRUITER_ID,
            AUTHORIZATION
        );

        assertThat(response.cvId()).isEqualTo(CV_ID);
        assertThat(response.url()).startsWith("https://");
        verify(profiles).createCandidateCvDownloadUrl(CANDIDATE_ID, CV_ID);
    }

    @Test
    void scopedMissingApplicationNeverCallsProfile() {
        when(applications.findByIdAndCompanyId(APPLICATION_ID, COMPANY_ID))
            .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getCv(
            APPLICATION_ID,
            RECRUITER_ID,
            AUTHORIZATION
        ))
            .isInstanceOf(BusinessException.class)
            .satisfies(error -> {
                BusinessException business = (BusinessException) error;
                assertThat(business.code()).isEqualTo("APPLICATION_NOT_FOUND");
                assertThat(business.status()).isEqualTo(HttpStatus.NOT_FOUND);
            });
        verify(profiles, never()).getCandidateCv(
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any()
        );
    }

    @Test
    void membershipFailureOccursBeforeApplicationQuery() {
        BusinessException denied = new BusinessException(
            "APPLICATION_ACCESS_DENIED",
            "Denied",
            HttpStatus.FORBIDDEN
        );
        when(companies.getRecruiterMembership(RECRUITER_ID, AUTHORIZATION))
            .thenThrow(denied);

        assertThatThrownBy(() -> service.getCv(
            APPLICATION_ID,
            RECRUITER_ID,
            AUTHORIZATION
        )).isSameAs(denied);
        verify(applications, never()).findByIdAndCompanyId(
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any()
        );
        verify(profiles, never()).getCandidateCv(
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any()
        );
    }

    private ApplicationEntity application() {
        return ApplicationEntity.applied(
            APPLICATION_ID,
            UUID.randomUUID(),
            COMPANY_ID,
            CANDIDATE_ID,
            UUID.randomUUID(),
            CV_ID,
            "Backend Engineer",
            null,
            com.recruitment.application.domain.ApplicationSource.SEARCH,
            CREATED_AT
        );
    }

    private ProfileCv profileCv(boolean deleted) {
        return new ProfileCv(
            CV_ID,
            CANDIDATE_ID,
            "Backend CV",
            "UPLOAD",
            FILE_ID,
            true,
            deleted,
            CREATED_AT.plusSeconds(60),
            2L,
            CREATED_AT,
            CREATED_AT.plusSeconds(120)
        );
    }
}
