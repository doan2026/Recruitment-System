package com.recruitment.application.offer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recruitment.application.api.BusinessException;
import com.recruitment.application.client.CompanyClient;
import com.recruitment.application.client.CompanyMemberRole;
import com.recruitment.application.client.RecruiterCompanyMembership;
import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationEventOutboxEntity;
import com.recruitment.application.domain.ApplicationStatus;
import com.recruitment.application.domain.OfferEntity;
import com.recruitment.application.domain.OfferStatus;
import com.recruitment.application.pipeline.ApplicationHistoryWriter;
import com.recruitment.application.pipeline.ApplicationPipelineRepository;
import com.recruitment.application.repository.ApplicationEventOutboxRepository;
import com.recruitment.application.repository.OfferRepository;
import java.math.BigDecimal;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Optional;
import java.util.UUID;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;

class ApplicationOfferServiceTest {
    private static final Instant NOW =
        Instant.parse("2026-08-25T08:00:00Z");
    private static final String AUTHORIZATION = "Bearer token";
    private static final String TOPIC = "application-events";
    private static final String FILE_URL =
        "https://files.example.test/offers/letter.pdf";

    private final ApplicationPipelineRepository applications =
        mock(ApplicationPipelineRepository.class);
    private final OfferRepository offers = mock(OfferRepository.class);
    private final ApplicationHistoryWriter history =
        mock(ApplicationHistoryWriter.class);
    private final ApplicationEventOutboxRepository outbox =
        mock(ApplicationEventOutboxRepository.class);
    private final CompanyClient companies = mock(CompanyClient.class);
    private final ApplicationEntity application =
        mock(ApplicationEntity.class);
    private final OfferEntity offer = mock(OfferEntity.class);

    private final UUID applicationId = UUID.randomUUID();
    private final UUID offerId = UUID.randomUUID();
    private final UUID companyId = UUID.randomUUID();
    private final UUID candidateId = UUID.randomUUID();
    private final UUID recruiterId = UUID.randomUUID();
    private final UUID jobOwnerId = UUID.randomUUID();
    private final UUID jobId = UUID.randomUUID();
    private final UUID fileId = UUID.randomUUID();

    private ApplicationOfferService service;

    @BeforeEach
    void setUp() {
        service = new ApplicationOfferService(
            applications,
            offers,
            history,
            outbox,
            companies,
            new ObjectMapper().findAndRegisterModules(),
            Clock.fixed(NOW, ZoneOffset.UTC),
            TOPIC
        );

        when(applications.findById(applicationId))
            .thenReturn(Optional.of(application));
        when(application.getId()).thenReturn(applicationId);
        when(application.getCompanyId()).thenReturn(companyId);
        when(application.getCandidateId()).thenReturn(candidateId);
        when(application.getRecruiterId()).thenReturn(jobOwnerId);
        when(application.getJobId()).thenReturn(jobId);
        when(application.getJobTitle()).thenReturn("Backend Engineer");
        when(application.getStatus()).thenReturn(ApplicationStatus.INTERVIEW);
        when(application.getVersion()).thenReturn(0L);

        when(companies.getRecruiterMembership(recruiterId, AUTHORIZATION))
            .thenReturn(new RecruiterCompanyMembership(
                companyId,
                CompanyMemberRole.MEMBER
            ));
        when(offers.existsByApplicationId(applicationId)).thenReturn(false);
        when(applications.transition(
            applicationId,
            ApplicationStatus.OFFER,
            NOW,
            0L
        )).thenReturn(1);
        when(applications.transition(
            applicationId,
            ApplicationStatus.HIRED,
            NOW,
            0L
        )).thenReturn(1);
        when(applications.transition(
            applicationId,
            ApplicationStatus.REJECTED,
            NOW,
            0L
        )).thenReturn(1);

        when(offers.findById(offerId)).thenReturn(Optional.of(offer));
        when(offer.getId()).thenReturn(offerId);
        when(offer.getApplicationId()).thenReturn(applicationId);
        when(offer.getSentBy()).thenReturn(recruiterId);
        when(offer.getSalary()).thenReturn(new BigDecimal("25000000.00"));
        when(offer.getStartDate()).thenReturn(LocalDate.of(2026, 9, 15));
        when(offer.getPosition()).thenReturn("Backend Engineer");
        when(offer.getNote()).thenReturn("Welcome aboard");
        when(offer.getFileId()).thenReturn(fileId);
        when(offer.getFileUrl()).thenReturn(FILE_URL);
        when(offer.getStatus()).thenReturn(OfferStatus.SENT);
        when(offer.getSentAt()).thenReturn(NOW.minusSeconds(3600));
        when(offer.getExpiresAt()).thenReturn(NOW.plusSeconds(86400));
        when(offer.getVersion()).thenReturn(0L);
        when(offers.respond(
            eq(offerId),
            any(OfferStatus.class),
            eq(NOW),
            nullable(String.class),
            eq(0L),
            eq(NOW)
        )).thenReturn(1);
    }

    @ParameterizedTest
    @EnumSource(CompanyMemberRole.class)
    void companyMemberSendsOfferWithHistoryAndSafeOutboxPayload(
        CompanyMemberRole role
    ) {
        when(companies.getRecruiterMembership(recruiterId, AUTHORIZATION))
            .thenReturn(new RecruiterCompanyMembership(companyId, role));

        OfferResponse response = service.send(
            applicationId,
            recruiterId,
            AUTHORIZATION,
            validCreateRequest()
        );

        assertThat(response.applicationId()).isEqualTo(applicationId);
        assertThat(response.sentBy())
            .isEqualTo(recruiterId)
            .isNotEqualTo(jobOwnerId);
        assertThat(response.status()).isEqualTo(OfferStatus.SENT);
        assertThat(response.applicationStatus())
            .isEqualTo(ApplicationStatus.OFFER);
        assertThat(response.applicationVersion()).isEqualTo(1L);
        assertThat(response.version()).isZero();
        assertThat(response.position()).isEqualTo("Senior Backend Engineer");
        assertThat(response.note()).isEqualTo("Welcome aboard");
        assertThat(response.salary()).isEqualByComparingTo("25000000.00");

        verify(applications).transition(
            applicationId,
            ApplicationStatus.OFFER,
            NOW,
            0L
        );
        ArgumentCaptor<OfferEntity> saved =
            ArgumentCaptor.forClass(OfferEntity.class);
        verify(offers).saveAndFlush(saved.capture());
        assertThat(saved.getValue().getApplicationId())
            .isEqualTo(applicationId);
        assertThat(saved.getValue().getSentBy()).isEqualTo(recruiterId);
        assertThat(saved.getValue().getFileId()).isEqualTo(fileId);
        assertThat(saved.getValue().getFileUrl()).isEqualTo(FILE_URL);
        assertThat(saved.getValue().getExpiresAt())
            .isEqualTo(NOW.plusSeconds(604800));

        verify(history).append(
            applicationId,
            ApplicationStatus.INTERVIEW,
            ApplicationStatus.OFFER,
            recruiterId,
            "Welcome aboard",
            NOW
        );
        ArgumentCaptor<ApplicationEventOutboxEntity> event =
            ArgumentCaptor.forClass(ApplicationEventOutboxEntity.class);
        verify(outbox).save(event.capture());
        assertThat(event.getValue().getTopic()).isEqualTo(TOPIC);
        assertThat(event.getValue().getEventKey()).isEqualTo(applicationId);
        assertThat(event.getValue().getPayload())
            .contains("\"action\":\"OFFER_SENT\"")
            .contains("\"from_status\":\"INTERVIEW\"")
            .contains("\"to_status\":\"OFFER\"")
            .contains("\"offer_status\":\"SENT\"")
            .contains("\"actor_id\":\"" + recruiterId + "\"")
            .doesNotContain("salary", "note", "file_url", FILE_URL);
    }

    @Test
    void recruiterFromAnotherCompanyCannotSendOffer() {
        when(companies.getRecruiterMembership(recruiterId, AUTHORIZATION))
            .thenReturn(new RecruiterCompanyMembership(
                UUID.randomUUID(),
                CompanyMemberRole.OWNER
            ));

        assertBusinessException(
            () -> service.send(
                applicationId,
                recruiterId,
                AUTHORIZATION,
                validCreateRequest()
            ),
            "APPLICATION_ACCESS_DENIED",
            HttpStatus.FORBIDDEN
        );

        verify(applications, never())
            .transition(any(), any(), any(), anyLong());
        verify(offers, never()).saveAndFlush(any());
        verify(history, never()).append(any(), any(), any(), any(), any(), any());
        verify(outbox, never()).save(any());
    }

    @Test
    void onlyInterviewApplicationCanReceiveOffer() {
        when(application.getStatus()).thenReturn(ApplicationStatus.REVIEWING);

        assertBusinessException(
            () -> service.send(
                applicationId,
                recruiterId,
                AUTHORIZATION,
                validCreateRequest()
            ),
            "APPLICATION_NOT_ELIGIBLE_FOR_OFFER",
            HttpStatus.CONFLICT
        );

        verify(applications, never())
            .transition(any(), any(), any(), anyLong());
        verify(offers, never()).saveAndFlush(any());
    }

    @Test
    void duplicateOfferIsRejectedBeforeTransition() {
        when(offers.existsByApplicationId(applicationId)).thenReturn(true);

        assertBusinessException(
            () -> service.send(
                applicationId,
                recruiterId,
                AUTHORIZATION,
                validCreateRequest()
            ),
            "OFFER_ALREADY_EXISTS",
            HttpStatus.CONFLICT
        );

        verify(applications, never())
            .transition(any(), any(), any(), anyLong());
        verify(offers, never()).saveAndFlush(any());
    }

    @Test
    void databaseDuplicateRaceMapsToConflictWithoutSideEffects() {
        when(offers.saveAndFlush(any(OfferEntity.class)))
            .thenThrow(databaseConstraintViolation(
                "offers_application_unique"
            ));

        assertBusinessException(
            () -> service.send(
                applicationId,
                recruiterId,
                AUTHORIZATION,
                validCreateRequest()
            ),
            "OFFER_ALREADY_EXISTS",
            HttpStatus.CONFLICT
        );

        verify(history, never()).append(any(), any(), any(), any(), any(), any());
        verify(outbox, never()).save(any());
    }

    @Test
    void staleApplicationVersionIsRejectedBeforeTransition() {
        CreateOfferRequest request = createRequest(
            new BigDecimal("25000000"),
            LocalDate.of(2026, 9, 15),
            "Backend Engineer",
            "Welcome aboard",
            fileId,
            FILE_URL,
            NOW.plusSeconds(604800),
            2L
        );

        assertBusinessException(
            () -> service.send(
                applicationId,
                recruiterId,
                AUTHORIZATION,
                request
            ),
            "APPLICATION_CHANGED_CONCURRENTLY",
            HttpStatus.CONFLICT
        );

        verify(applications, never())
            .transition(any(), any(), any(), anyLong());
        verify(offers, never()).saveAndFlush(any());
    }

    @Test
    void atomicApplicationConflictStopsOfferHistoryAndOutbox() {
        when(applications.transition(
            applicationId,
            ApplicationStatus.OFFER,
            NOW,
            0L
        )).thenReturn(0);

        assertBusinessException(
            () -> service.send(
                applicationId,
                recruiterId,
                AUTHORIZATION,
                validCreateRequest()
            ),
            "APPLICATION_CHANGED_CONCURRENTLY",
            HttpStatus.CONFLICT
        );

        verify(offers, never()).saveAndFlush(any());
        verify(history, never()).append(any(), any(), any(), any(), any(), any());
        verify(outbox, never()).save(any());
    }

    @Test
    void invalidSalaryIsRejectedDefensively() {
        for (BigDecimal salary : Arrays.asList(
            null,
            BigDecimal.ZERO,
            new BigDecimal("10.001"),
            new BigDecimal("123456789012345678.00")
        )) {
            assertBusinessException(
                () -> service.send(
                    applicationId,
                    recruiterId,
                    AUTHORIZATION,
                    createRequest(
                        salary,
                        LocalDate.of(2026, 9, 15),
                        "Backend Engineer",
                        null,
                        null,
                        null,
                        NOW.plusSeconds(604800),
                        0L
                    )
                ),
                "INVALID_OFFER_SALARY",
                HttpStatus.BAD_REQUEST
            );
        }

        verify(applications, never())
            .transition(any(), any(), any(), anyLong());
    }

    @Test
    void invalidCoreTextAndDatesAreRejectedDefensively() {
        assertBusinessException(
            () -> service.send(
                applicationId,
                recruiterId,
                AUTHORIZATION,
                createRequest(
                    BigDecimal.TEN,
                    LocalDate.of(2026, 8, 24),
                    "Backend Engineer",
                    null,
                    null,
                    null,
                    NOW.plusSeconds(3600),
                    0L
                )
            ),
            "INVALID_OFFER_START_DATE",
            HttpStatus.BAD_REQUEST
        );
        assertBusinessException(
            () -> service.send(
                applicationId,
                recruiterId,
                AUTHORIZATION,
                createRequest(
                    BigDecimal.TEN,
                    LocalDate.of(2026, 8, 25),
                    "   ",
                    null,
                    null,
                    null,
                    NOW.plusSeconds(3600),
                    0L
                )
            ),
            "INVALID_OFFER_POSITION",
            HttpStatus.BAD_REQUEST
        );

        verify(applications, never())
            .transition(any(), any(), any(), anyLong());
    }

    @Test
    void incompleteOrUnsafeFileReferenceIsRejected() {
        CreateOfferRequest missingUrl = createRequest(
            BigDecimal.TEN,
            LocalDate.of(2026, 8, 25),
            "Backend Engineer",
            null,
            fileId,
            null,
            NOW.plusSeconds(3600),
            0L
        );
        CreateOfferRequest unsafeUrl = createRequest(
            BigDecimal.TEN,
            LocalDate.of(2026, 8, 25),
            "Backend Engineer",
            null,
            fileId,
            "file:///tmp/offer.pdf",
            NOW.plusSeconds(3600),
            0L
        );

        assertBusinessException(
            () -> service.send(
                applicationId,
                recruiterId,
                AUTHORIZATION,
                missingUrl
            ),
            "INVALID_OFFER_FILE",
            HttpStatus.BAD_REQUEST
        );
        assertBusinessException(
            () -> service.send(
                applicationId,
                recruiterId,
                AUTHORIZATION,
                unsafeUrl
            ),
            "INVALID_OFFER_FILE",
            HttpStatus.BAD_REQUEST
        );

        verify(applications, never())
            .transition(any(), any(), any(), anyLong());
    }

    @Test
    void nonFutureExpiryIsRejected() {
        CreateOfferRequest request = createRequest(
            BigDecimal.TEN,
            LocalDate.of(2026, 8, 25),
            "Backend Engineer",
            null,
            null,
            null,
            NOW,
            0L
        );

        assertBusinessException(
            () -> service.send(
                applicationId,
                recruiterId,
                AUTHORIZATION,
                request
            ),
            "INVALID_OFFER_EXPIRY",
            HttpStatus.BAD_REQUEST
        );

        verify(applications, never())
            .transition(any(), any(), any(), anyLong());
    }

    @Test
    void candidateAcceptsOfferAndApplicationBecomesHired() {
        stubRespondableApplication();

        OfferResponse response = service.respond(
            offerId,
            candidateId,
            new RespondOfferRequest(OfferDecision.ACCEPTED, "ignored", 0L, 0L)
        );

        assertThat(response.status()).isEqualTo(OfferStatus.ACCEPTED);
        assertThat(response.applicationStatus())
            .isEqualTo(ApplicationStatus.HIRED);
        assertThat(response.responseNote()).isNull();
        assertThat(response.respondedAt()).isEqualTo(NOW);
        assertThat(response.version()).isEqualTo(1L);
        assertThat(response.applicationVersion()).isEqualTo(1L);
        verify(offers).respond(
            offerId,
            OfferStatus.ACCEPTED,
            NOW,
            null,
            0L,
            NOW
        );
        verify(applications).transition(
            applicationId,
            ApplicationStatus.HIRED,
            NOW,
            0L
        );
        verify(history).append(
            applicationId,
            ApplicationStatus.OFFER,
            ApplicationStatus.HIRED,
            candidateId,
            null,
            NOW
        );
        assertResponseEvent(OfferStatus.ACCEPTED, ApplicationStatus.HIRED);
    }

    @Test
    void candidateDeclinesOfferAndApplicationBecomesRejected() {
        stubRespondableApplication();

        OfferResponse response = service.respond(
            offerId,
            candidateId,
            new RespondOfferRequest(
                OfferDecision.DECLINED,
                "  Accepted another role  ",
                0L,
                0L
            )
        );

        assertThat(response.status()).isEqualTo(OfferStatus.DECLINED);
        assertThat(response.applicationStatus())
            .isEqualTo(ApplicationStatus.REJECTED);
        assertThat(response.responseNote()).isEqualTo("Accepted another role");
        verify(offers).respond(
            offerId,
            OfferStatus.DECLINED,
            NOW,
            "Accepted another role",
            0L,
            NOW
        );
        verify(applications).transition(
            applicationId,
            ApplicationStatus.REJECTED,
            NOW,
            0L
        );
        verify(history).append(
            applicationId,
            ApplicationStatus.OFFER,
            ApplicationStatus.REJECTED,
            candidateId,
            "Accepted another role",
            NOW
        );
        assertResponseEvent(OfferStatus.DECLINED, ApplicationStatus.REJECTED);
    }

    @Test
    void anotherCandidateCannotRespondToOffer() {
        stubRespondableApplication();

        assertBusinessException(
            () -> service.respond(
                offerId,
                UUID.randomUUID(),
                new RespondOfferRequest(
                    OfferDecision.ACCEPTED,
                    null,
                    0L,
                    0L
                )
            ),
            "OFFER_ACCESS_DENIED",
            HttpStatus.FORBIDDEN
        );

        verify(offers, never()).respond(
            any(), any(), any(), any(), anyLong(), any()
        );
        verify(applications, never())
            .transition(any(), any(), any(), anyLong());
        verify(history, never()).append(any(), any(), any(), any(), any(), any());
        verify(outbox, never()).save(any());
    }

    @Test
    void alreadyRespondedOfferCannotBeRespondedToAgain() {
        stubRespondableApplication();
        when(offer.getStatus()).thenReturn(OfferStatus.ACCEPTED);

        BusinessException exception = assertBusinessException(
            () -> service.respond(
                offerId,
                candidateId,
                new RespondOfferRequest(
                    OfferDecision.ACCEPTED,
                    null,
                    0L,
                    0L
                )
            ),
            "OFFER_ALREADY_RESPONDED",
            HttpStatus.CONFLICT
        );

        assertThat(exception.details())
            .containsEntry("currentStatus", "ACCEPTED");
        verify(offers, never()).respond(
            any(), any(), any(), any(), anyLong(), any()
        );
    }

    @Test
    void expiredOfferCannotBeRespondedTo() {
        stubRespondableApplication();
        when(offer.getExpiresAt()).thenReturn(NOW);

        assertBusinessException(
            () -> service.respond(
                offerId,
                candidateId,
                new RespondOfferRequest(
                    OfferDecision.ACCEPTED,
                    null,
                    0L,
                    0L
                )
            ),
            "OFFER_EXPIRED",
            HttpStatus.CONFLICT
        );

        verify(offers, never()).respond(
            any(), any(), any(), any(), anyLong(), any()
        );
        verify(applications, never())
            .transition(any(), any(), any(), anyLong());
    }

    @Test
    void staleOfferVersionIsRejectedBeforeAtomicUpdates() {
        stubRespondableApplication();

        assertBusinessException(
            () -> service.respond(
                offerId,
                candidateId,
                new RespondOfferRequest(
                    OfferDecision.ACCEPTED,
                    null,
                    2L,
                    0L
                )
            ),
            "OFFER_CHANGED_CONCURRENTLY",
            HttpStatus.CONFLICT
        );

        verify(offers, never()).respond(
            any(), any(), any(), any(), anyLong(), any()
        );
        verify(applications, never())
            .transition(any(), any(), any(), anyLong());
    }

    @Test
    void staleApplicationVersionIsRejectedBeforeResponding() {
        stubRespondableApplication();

        assertBusinessException(
            () -> service.respond(
                offerId,
                candidateId,
                new RespondOfferRequest(
                    OfferDecision.ACCEPTED,
                    null,
                    0L,
                    2L
                )
            ),
            "APPLICATION_CHANGED_CONCURRENTLY",
            HttpStatus.CONFLICT
        );

        verify(offers, never()).respond(
            any(), any(), any(), any(), anyLong(), any()
        );
        verify(applications, never())
            .transition(any(), any(), any(), anyLong());
    }

    @Test
    void atomicOfferConflictIsDiagnosedAndStopsApplicationUpdate() {
        stubRespondableApplication();
        when(offers.respond(
            eq(offerId),
            any(OfferStatus.class),
            eq(NOW),
            nullable(String.class),
            eq(0L),
            eq(NOW)
        )).thenReturn(0);

        assertBusinessException(
            () -> service.respond(
                offerId,
                candidateId,
                new RespondOfferRequest(
                    OfferDecision.ACCEPTED,
                    null,
                    0L,
                    0L
                )
            ),
            "OFFER_CHANGED_CONCURRENTLY",
            HttpStatus.CONFLICT
        );

        verify(applications, never())
            .transition(any(), any(), any(), anyLong());
        verify(history, never()).append(any(), any(), any(), any(), any(), any());
        verify(outbox, never()).save(any());
    }

    @Test
    void atomicApplicationConflictStopsHistoryAndOutbox() {
        stubRespondableApplication();
        when(applications.transition(
            applicationId,
            ApplicationStatus.HIRED,
            NOW,
            0L
        )).thenReturn(0);

        assertBusinessException(
            () -> service.respond(
                offerId,
                candidateId,
                new RespondOfferRequest(
                    OfferDecision.ACCEPTED,
                    null,
                    0L,
                    0L
                )
            ),
            "APPLICATION_CHANGED_CONCURRENTLY",
            HttpStatus.CONFLICT
        );

        verify(offers).respond(
            offerId,
            OfferStatus.ACCEPTED,
            NOW,
            null,
            0L,
            NOW
        );
        verify(history, never()).append(any(), any(), any(), any(), any(), any());
        verify(outbox, never()).save(any());
    }

    @Test
    void declineRequiresReason() {
        stubRespondableApplication();

        assertBusinessException(
            () -> service.respond(
                offerId,
                candidateId,
                new RespondOfferRequest(
                    OfferDecision.DECLINED,
                    "   ",
                    0L,
                    0L
                )
            ),
            "DECLINE_REASON_REQUIRED",
            HttpStatus.BAD_REQUEST
        );

        verify(offers, never()).respond(
            any(), any(), any(), any(), anyLong(), any()
        );
        verify(applications, never())
            .transition(any(), any(), any(), anyLong());
    }

    private void assertResponseEvent(
        OfferStatus offerStatus,
        ApplicationStatus applicationStatus
    ) {
        ArgumentCaptor<ApplicationEventOutboxEntity> event =
            ArgumentCaptor.forClass(ApplicationEventOutboxEntity.class);
        verify(outbox).save(event.capture());
        assertThat(event.getValue().getEventKey()).isEqualTo(applicationId);
        assertThat(event.getValue().getPayload())
            .contains("\"action\":\"STATUS_CHANGED\"")
            .contains("\"offer_status\":\"" + offerStatus + "\"")
            .contains("\"to_status\":\"" + applicationStatus + "\"")
            .contains("\"actor_id\":\"" + candidateId + "\"")
            .doesNotContain("salary", "note", "file_url", FILE_URL);
    }

    private void stubRespondableApplication() {
        when(application.getStatus()).thenReturn(ApplicationStatus.OFFER);
    }

    private CreateOfferRequest validCreateRequest() {
        return createRequest(
            new BigDecimal("25000000"),
            LocalDate.of(2026, 9, 15),
            "  Senior Backend Engineer  ",
            "  Welcome aboard  ",
            fileId,
            FILE_URL,
            NOW.plusSeconds(604800),
            0L
        );
    }

    private CreateOfferRequest createRequest(
        BigDecimal salary,
        LocalDate startDate,
        String position,
        String note,
        UUID requestedFileId,
        String fileUrl,
        Instant expiresAt,
        Long expectedApplicationVersion
    ) {
        return new CreateOfferRequest(
            salary,
            startDate,
            position,
            note,
            requestedFileId,
            fileUrl,
            expiresAt,
            expectedApplicationVersion
        );
    }

    private DataIntegrityViolationException databaseConstraintViolation(
        String constraintName
    ) {
        ConstraintViolationException hibernateFailure =
            new ConstraintViolationException(
                "Database constraint violation",
                new SQLException("Constraint violation"),
                "insert into offers",
                constraintName
            );
        return new DataIntegrityViolationException(
            "Offer insert failed",
            hibernateFailure
        );
    }

    private BusinessException assertBusinessException(
        ThrowingCallable action,
        String code,
        HttpStatus status
    ) {
        BusinessException exception = catchThrowableOfType(
            action,
            BusinessException.class
        );
        assertThat(exception).isNotNull();
        assertThat(exception.code()).isEqualTo(code);
        assertThat(exception.status()).isEqualTo(status);
        return exception;
    }
}
