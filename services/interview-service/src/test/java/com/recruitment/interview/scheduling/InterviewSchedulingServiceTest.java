package com.recruitment.interview.scheduling;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.recruitment.interview.api.BusinessException;
import com.recruitment.interview.client.ApplicationAuthorizationContext;
import com.recruitment.interview.client.ApplicationClient;
import com.recruitment.interview.domain.InterviewEntity;
import com.recruitment.interview.domain.InterviewMode;
import com.recruitment.interview.repository.InterviewRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class InterviewSchedulingServiceTest {
    private static final Instant NOW =
        Instant.parse("2026-08-28T05:00:00Z");
    private static final UUID RECRUITER_ID = UUID.randomUUID();
    private static final UUID APPLICATION_ID = UUID.randomUUID();

    @Mock
    private ApplicationClient applications;
    @Mock
    private InterviewRepository interviews;
    @Mock
    private InterviewSchedulingTransaction transaction;

    private InterviewSchedulingService service;

    @BeforeEach
    void setUp() {
        service = new InterviewSchedulingService(
            applications,
            interviews,
            transaction,
            Clock.fixed(NOW, ZoneOffset.UTC)
        );
    }

    @Test
    void schedulesWithOnlyAuthoritativeApplicationContext() {
        ApplicationAuthorizationContext context = context(APPLICATION_ID);
        when(interviews.findByScheduledByAndRequestId(any(), any()))
            .thenReturn(Optional.empty());
        when(applications.authorizeScheduling(APPLICATION_ID, "Bearer jwt"))
            .thenReturn(context);
        when(transaction.create(any())).thenAnswer(invocation ->
            invocation.getArgument(0)
        );

        ScheduleInterviewResult result = service.schedule(
            RECRUITER_ID,
            "jwt",
            validRequest()
        );

        assertThat(result.replayed()).isFalse();
        assertThat(result.interview().applicationId())
            .isEqualTo(APPLICATION_ID);
        assertThat(result.interview().companyId()).isEqualTo(context.companyId());
        assertThat(result.interview().jobId()).isEqualTo(context.jobId());
        assertThat(result.interview().candidateId())
            .isEqualTo(context.candidateId());
        assertThat(result.interview().interviewerId())
            .isEqualTo(RECRUITER_ID);
        assertThat(result.interview().scheduledStart())
            .isEqualTo(Instant.parse("2026-08-29T02:00:00Z"));
        assertThat(result.interview().scheduledEnd())
            .isEqualTo(Instant.parse("2026-08-29T02:45:00Z"));

        ArgumentCaptor<InterviewEntity> saved =
            ArgumentCaptor.forClass(InterviewEntity.class);
        verify(transaction).create(saved.capture());
        assertThat(saved.getValue().getApplicationVersion()).isEqualTo(7);
        assertThat(saved.getValue().getScheduledBy()).isEqualTo(RECRUITER_ID);
    }

    @Test
    void rejectsOnlineUntilJitsiLifecycleExists() {
        CreateInterviewRequest request = copy(
            validRequest(),
            InterviewMode.ONLINE,
            null,
            validRequest().scheduledStart(),
            validRequest().timeZone(),
            validRequest().durationMinutes(),
            validRequest().notes()
        );

        assertCode(request, "INTERVIEW_ONLINE_NOT_READY");
        verify(applications, never()).authorizeScheduling(any(), any());
    }

    @Test
    void rejectsInvalidDurationPastSubMillisecondAndOffsetMismatch() {
        CreateInterviewRequest invalidDuration = copy(
            validRequest(),
            InterviewMode.OFFLINE,
            "Room 2",
            validRequest().scheduledStart(),
            validRequest().timeZone(),
            31,
            null
        );
        assertCode(invalidDuration, "VALIDATION_ERROR");

        CreateInterviewRequest past = copy(
            validRequest(),
            InterviewMode.OFFLINE,
            "Room 2",
            OffsetDateTime.parse("2026-08-28T11:00:00+07:00"),
            "Asia/Ho_Chi_Minh",
            45,
            null
        );
        assertCode(past, "VALIDATION_ERROR");

        CreateInterviewRequest subMillisecond = copy(
            validRequest(),
            InterviewMode.OFFLINE,
            "Room 2",
            OffsetDateTime.parse("2026-08-29T09:00:00.000001+07:00"),
            "Asia/Ho_Chi_Minh",
            45,
            null
        );
        assertCode(subMillisecond, "VALIDATION_ERROR");

        CreateInterviewRequest wrongOffset = copy(
            validRequest(),
            InterviewMode.OFFLINE,
            "Room 2",
            OffsetDateTime.parse("2026-08-29T09:00:00Z"),
            "Asia/Ho_Chi_Minh",
            45,
            null
        );
        assertCode(wrongOffset, "VALIDATION_ERROR");
    }

    @Test
    void rejectsDstGapAndAcceptsExplicitDstOverlapOffset() {
        CreateInterviewRequest gap = copy(
            validRequest(),
            InterviewMode.OFFLINE,
            "Room 2",
            OffsetDateTime.parse("2027-03-14T02:30:00-05:00"),
            "America/New_York",
            45,
            null
        );
        assertCode(gap, "VALIDATION_ERROR");

        CreateInterviewRequest overlap = copy(
            validRequest(),
            InterviewMode.OFFLINE,
            "Room 2",
            OffsetDateTime.parse("2027-11-07T01:30:00-05:00"),
            "America/New_York",
            45,
            null
        );
        when(interviews.findByScheduledByAndRequestId(any(), any()))
            .thenReturn(Optional.empty());
        when(applications.authorizeScheduling(eq(APPLICATION_ID), any()))
            .thenReturn(context(APPLICATION_ID));
        when(transaction.create(any())).thenAnswer(invocation ->
            invocation.getArgument(0)
        );

        assertThat(service.schedule(RECRUITER_ID, "jwt", overlap)
            .interview().scheduledStart())
            .isEqualTo(Instant.parse("2027-11-07T06:30:00Z"));
    }

    @Test
    void replaysSameRequestWithoutCallingApplicationAgain() {
        when(interviews.findByScheduledByAndRequestId(any(), any()))
            .thenReturn(Optional.empty());
        when(applications.authorizeScheduling(eq(APPLICATION_ID), any()))
            .thenReturn(context(APPLICATION_ID));
        when(transaction.create(any())).thenAnswer(invocation ->
            invocation.getArgument(0)
        );
        CreateInterviewRequest request = validRequest();
        ScheduleInterviewResult first = service.schedule(
            RECRUITER_ID,
            "jwt",
            request
        );

        InterviewEntity existing = entityFrom(first.interview(), request);
        when(interviews.findByScheduledByAndRequestId(
            RECRUITER_ID,
            request.requestId()
        )).thenReturn(Optional.of(existing));
        ScheduleInterviewResult replay = service.schedule(
            RECRUITER_ID,
            "new-jwt",
            request
        );

        assertThat(replay.replayed()).isTrue();
        assertThat(replay.interview().id()).isEqualTo(first.interview().id());
        verify(applications).authorizeScheduling(APPLICATION_ID, "Bearer jwt");
    }

    @Test
    void rejectsSameRequestIdWithDifferentPayload() {
        when(interviews.findByScheduledByAndRequestId(any(), any()))
            .thenReturn(Optional.empty());
        when(applications.authorizeScheduling(eq(APPLICATION_ID), any()))
            .thenReturn(context(APPLICATION_ID));
        when(transaction.create(any())).thenAnswer(invocation ->
            invocation.getArgument(0)
        );
        CreateInterviewRequest request = validRequest();
        ScheduleInterviewResult first = service.schedule(
            RECRUITER_ID,
            "jwt",
            request
        );
        InterviewEntity existing = entityFrom(first.interview(), request);
        when(interviews.findByScheduledByAndRequestId(
            RECRUITER_ID,
            request.requestId()
        )).thenReturn(Optional.of(existing));
        CreateInterviewRequest changed = copy(
            request,
            InterviewMode.OFFLINE,
            "Different room",
            request.scheduledStart(),
            request.timeZone(),
            request.durationMinutes(),
            request.notes()
        );

        assertCode(changed, "INTERVIEW_IDEMPOTENCY_CONFLICT");
    }

    private void assertCode(CreateInterviewRequest request, String code) {
        assertThatThrownBy(() -> service.schedule(
            RECRUITER_ID,
            "jwt",
            request
        )).isInstanceOfSatisfying(BusinessException.class, exception ->
            assertThat(exception.code()).isEqualTo(code)
        );
    }

    private CreateInterviewRequest validRequest() {
        return new CreateInterviewRequest(
            APPLICATION_ID,
            UUID.randomUUID(),
            2,
            OffsetDateTime.parse("2026-08-29T09:00:00+07:00"),
            "Asia/Ho_Chi_Minh",
            45,
            InterviewMode.OFFLINE,
            " Room 2 ",
            " Hiring manager round "
        );
    }

    private CreateInterviewRequest copy(
        CreateInterviewRequest source,
        InterviewMode mode,
        String location,
        OffsetDateTime start,
        String timeZone,
        int duration,
        String notes
    ) {
        return new CreateInterviewRequest(
            source.applicationId(),
            source.requestId(),
            source.roundNumber(),
            start,
            timeZone,
            duration,
            mode,
            location,
            notes
        );
    }

    private ApplicationAuthorizationContext context(UUID applicationId) {
        return new ApplicationAuthorizationContext(
            applicationId,
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            "REVIEWING",
            7
        );
    }

    private InterviewEntity entityFrom(
        InterviewResponse response,
        CreateInterviewRequest request
    ) {
        return InterviewEntity.schedule(
            response.id(),
            response.applicationId(),
            response.applicationVersion(),
            "REVIEWING",
            response.companyId(),
            response.jobId(),
            response.candidateId(),
            response.interviewerId(),
            request.requestId(),
            hashFromFirst(response, request),
            response.roundNumber(),
            response.scheduledStart(),
            response.scheduledEnd(),
            response.timeZone(),
            response.durationMinutes(),
            response.mode(),
            response.location(),
            response.notes(),
            response.createdAt()
        );
    }

    private String hashFromFirst(
        InterviewResponse response,
        CreateInterviewRequest request
    ) {
        ArgumentCaptor<InterviewEntity> captor =
            ArgumentCaptor.forClass(InterviewEntity.class);
        verify(transaction).create(captor.capture());
        return captor.getValue().getRequestHash();
    }
}
