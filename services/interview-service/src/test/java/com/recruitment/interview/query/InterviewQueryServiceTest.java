package com.recruitment.interview.query;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.recruitment.interview.api.BusinessException;
import com.recruitment.interview.client.ApplicationAuthorizationContext;
import com.recruitment.interview.client.ApplicationClient;
import com.recruitment.interview.client.CompanyMemberRole;
import com.recruitment.interview.client.CompanyMembershipClient;
import com.recruitment.interview.client.RecruiterCompanyMembership;
import com.recruitment.interview.domain.InterviewMode;
import com.recruitment.interview.domain.InterviewStatus;
import com.recruitment.interview.query.InterviewQueryModels.Availability;
import com.recruitment.interview.query.InterviewQueryModels.Item;
import com.recruitment.interview.query.InterviewQueryModels.Page;
import com.recruitment.interview.query.InterviewQueryModels.Slot;
import com.recruitment.interview.query.InterviewQueryService.AvailabilityQuery;
import com.recruitment.interview.query.InterviewQueryService.CalendarQuery;
import com.recruitment.interview.query.InterviewQueryService.HistoryQuery;
import com.recruitment.interview.query.InterviewQueryService.MyQuery;
import com.recruitment.interview.query.InterviewQueryService.Viewer;
import com.recruitment.interview.query.InterviewQueryService.ViewerRole;
import com.recruitment.interview.query.InterviewReadRepository.BusyInterval;
import com.recruitment.interview.query.InterviewReadRepository.Filters;
import com.recruitment.interview.query.InterviewReadRepository.InterviewReadRow;
import com.recruitment.interview.query.InterviewReadRepository.PagePosition;
import com.recruitment.interview.query.InterviewReadRepository.Visibility;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

@ExtendWith(MockitoExtension.class)
class InterviewQueryServiceTest {
    private static final Instant NOW = Instant.parse("2026-08-28T00:00:00Z");
    private static final String RAW_TOKEN = "header.payload.signature";
    private static final String CURSOR_KEY =
        "interview-query-test-hmac-key-at-least-32-bytes";

    private static final UUID CANDIDATE_ID = uuid(
        "123e4567-e89b-42d3-a456-426614174001"
    );
    private static final UUID RECRUITER_ID = uuid(
        "223e4567-e89b-42d3-a456-426614174002"
    );
    private static final UUID COMPANY_ID = uuid(
        "323e4567-e89b-42d3-a456-426614174003"
    );
    private static final UUID APPLICATION_ID = uuid(
        "423e4567-e89b-42d3-a456-426614174004"
    );
    private static final UUID SECOND_APPLICATION_ID = uuid(
        "523e4567-e89b-42d3-a456-426614174005"
    );
    private static final UUID JOB_ID = uuid(
        "623e4567-e89b-42d3-a456-426614174006"
    );
    private static final UUID INTERVIEW_ID = uuid(
        "723e4567-e89b-42d3-a456-426614174007"
    );
    private static final UUID SECOND_INTERVIEW_ID = uuid(
        "823e4567-e89b-42d3-a456-426614174008"
    );

    @Mock
    private InterviewReadRepository interviews;
    @Mock
    private CompanyMembershipClient companies;
    @Mock
    private ApplicationClient applications;

    private InterviewQueryService service;

    @BeforeEach
    void setUp() {
        service = new InterviewQueryService(
            interviews,
            new InterviewCursorCodec(CURSOR_KEY),
            companies,
            applications,
            Clock.fixed(NOW, ZoneOffset.UTC)
        );
    }

    @Test
    void candidateDetailUsesSnapshotVisibilityAndRedactsInternalFields() {
        InterviewReadRow row = row(INTERVIEW_ID, CANDIDATE_ID, RECRUITER_ID);
        when(interviews.findDetail(
            INTERVIEW_ID,
            Visibility.candidate(CANDIDATE_ID)
        )).thenReturn(Optional.of(row));

        Item item = service.detail(
            candidate(),
            RAW_TOKEN,
            INTERVIEW_ID.toString()
        );

        assertThat(item.applicationId()).isEqualTo(APPLICATION_ID);
        assertThat(item.jobId()).isEqualTo(JOB_ID);
        assertThat(item.location()).isEqualTo("Room 2");
        assertThat(item.companyId()).isNull();
        assertThat(item.candidateId()).isNull();
        assertThat(item.interviewerId()).isNull();
        assertThat(item.scheduledBy()).isNull();
        assertThat(item.notes()).isNull();
        assertThat(item.createdAt()).isNull();
        assertThat(item.updatedAt()).isNull();
        verifyNoInteractions(companies, applications);
    }

    @Test
    void recruiterDetailRevalidatesMembershipAndReturnsRecruiterOnlyDetail() {
        membership(CompanyMemberRole.OWNER);
        InterviewReadRow row = row(INTERVIEW_ID, CANDIDATE_ID, RECRUITER_ID);
        when(interviews.findDetail(
            INTERVIEW_ID,
            Visibility.company(COMPANY_ID)
        )).thenReturn(Optional.of(row));

        Item item = service.detail(
            recruiter(),
            RAW_TOKEN,
            INTERVIEW_ID.toString()
        );

        assertThat(item.companyId()).isEqualTo(COMPANY_ID);
        assertThat(item.candidateId()).isEqualTo(CANDIDATE_ID);
        assertThat(item.interviewerId()).isEqualTo(RECRUITER_ID);
        assertThat(item.scheduledBy()).isEqualTo(RECRUITER_ID);
        assertThat(item.notes()).isEqualTo("Internal scorecard note");
        assertThat(item.createdAt()).isNotNull();
        assertThat(item.updatedAt()).isNotNull();
        verify(companies).resolve(RECRUITER_ID, RAW_TOKEN);
    }

    @Test
    void scopedMissingDetailReturnsNotFoundAndMembershipFailureFailsClosed() {
        when(interviews.findDetail(
            INTERVIEW_ID,
            Visibility.candidate(CANDIDATE_ID)
        )).thenReturn(Optional.empty());

        assertCode(
            () -> service.detail(
                candidate(),
                RAW_TOKEN,
                INTERVIEW_ID.toString()
            ),
            "INTERVIEW_NOT_FOUND",
            HttpStatus.NOT_FOUND
        );

        BusinessException denied = new BusinessException(
            "INTERVIEW_ACCESS_DENIED",
            "membership revoked",
            HttpStatus.FORBIDDEN
        );
        when(companies.resolve(RECRUITER_ID, RAW_TOKEN)).thenThrow(denied);
        assertThatThrownBy(() -> service.detail(
            recruiter(),
            RAW_TOKEN,
            INTERVIEW_ID.toString()
        )).isSameAs(denied);
        verify(interviews, never()).findDetail(
            eq(INTERVIEW_ID),
            eq(Visibility.company(COMPANY_ID))
        );
    }

    @Test
    void recruiterMyIsCompanyAndSelfScopedAndListDtoStaysMinimal() {
        membership(CompanyMemberRole.MEMBER);
        when(interviews.findPage(
            any(),
            any(),
            any(),
            any(Boolean.class),
            anyInt(),
            any()
        )).thenReturn(List.of(row(
            INTERVIEW_ID,
            CANDIDATE_ID,
            RECRUITER_ID
        )));

        Page page = service.my(
            recruiter(),
            RAW_TOKEN,
            new MyQuery("UPCOMING", null, null, null, null, null)
        );

        ArgumentCaptor<Visibility> visibility =
            ArgumentCaptor.forClass(Visibility.class);
        ArgumentCaptor<Filters> filters = ArgumentCaptor.forClass(Filters.class);
        verify(interviews).findPage(
            visibility.capture(),
            filters.capture(),
            eq(null),
            eq(true),
            eq(21),
            eq(NOW)
        );
        assertThat(visibility.getValue()).isEqualTo(
            Visibility.interviewer(COMPANY_ID, RECRUITER_ID)
        );
        assertThat(filters.getValue().endingAfter()).isEqualTo(NOW);
        Item item = page.items().getFirst();
        assertThat(item.companyId()).isEqualTo(COMPANY_ID);
        assertThat(item.candidateId()).isEqualTo(CANDIDATE_ID);
        assertThat(item.notes()).isNull();
        assertThat(item.scheduledBy()).isNull();
        assertThat(item.createdAt()).isNull();
        assertThat(item.updatedAt()).isNull();
    }

    @Test
    void candidateMyNeverCallsMembershipAndUsesCandidateScope() {
        when(interviews.findPage(
            any(),
            any(),
            any(),
            any(Boolean.class),
            anyInt(),
            any()
        )).thenReturn(List.of());

        service.my(
            candidate(),
            RAW_TOKEN,
            new MyQuery("PAST", null, null, List.of("COMPLETED"), "5", null)
        );

        ArgumentCaptor<Visibility> visibility =
            ArgumentCaptor.forClass(Visibility.class);
        ArgumentCaptor<Filters> filters = ArgumentCaptor.forClass(Filters.class);
        verify(interviews).findPage(
            visibility.capture(),
            filters.capture(),
            eq(null),
            eq(false),
            eq(6),
            eq(NOW)
        );
        assertThat(visibility.getValue()).isEqualTo(
            Visibility.candidate(CANDIDATE_ID)
        );
        assertThat(filters.getValue().endingAtOrBefore()).isEqualTo(NOW);
        assertThat(filters.getValue().statuses()).containsExactly(
            InterviewStatus.COMPLETED
        );
        verifyNoInteractions(companies, applications);
    }

    @Test
    void historyEnforcesCandidateAndRecruiterIdentityFilterRules() {
        HistoryQuery noIdentity = new HistoryQuery(
            null, null, null, null, null, null, null
        );
        assertValidation(() -> service.history(
            candidate(),
            RAW_TOKEN,
            noIdentity
        ));
        assertValidation(() -> service.history(
            recruiter(),
            RAW_TOKEN,
            noIdentity
        ));
        assertValidation(() -> service.history(
            candidate(),
            RAW_TOKEN,
            new HistoryQuery(
                APPLICATION_ID.toString(),
                JOB_ID.toString(),
                null,
                null,
                null,
                null,
                null
            )
        ));
        verifyNoInteractions(interviews, companies, applications);
    }

    @Test
    void historyForwardsFiltersAndCursorCannotCrossStatusFilter() {
        InterviewReadRow first = row(
            INTERVIEW_ID,
            CANDIDATE_ID,
            RECRUITER_ID
        );
        InterviewReadRow second = row(
            SECOND_INTERVIEW_ID,
            CANDIDATE_ID,
            RECRUITER_ID
        );
        when(interviews.findPage(
            any(),
            any(),
            any(),
            any(Boolean.class),
            anyInt(),
            any()
        )).thenReturn(List.of(first, second));
        HistoryQuery query = new HistoryQuery(
            APPLICATION_ID.toString(),
            null,
            null,
            null,
            List.of("SCHEDULED"),
            "1",
            null
        );

        Page firstPage = service.history(candidate(), RAW_TOKEN, query);

        assertThat(firstPage.items()).hasSize(1);
        assertThat(firstPage.nextCursor()).isNotBlank();
        ArgumentCaptor<Filters> filters = ArgumentCaptor.forClass(Filters.class);
        verify(interviews).findPage(
            eq(Visibility.candidate(CANDIDATE_ID)),
            filters.capture(),
            eq(null),
            eq(false),
            eq(2),
            eq(NOW)
        );
        assertThat(filters.getValue().applicationId()).isEqualTo(APPLICATION_ID);
        assertThat(filters.getValue().statuses()).containsExactly(
            InterviewStatus.SCHEDULED
        );

        HistoryQuery changedFilter = new HistoryQuery(
            APPLICATION_ID.toString(),
            null,
            null,
            null,
            List.of("CONFIRMED"),
            "1",
            firstPage.nextCursor()
        );
        assertCode(
            () -> service.history(candidate(), RAW_TOKEN, changedFilter),
            "INTERVIEW_CURSOR_INVALID",
            HttpStatus.BAD_REQUEST
        );
        verify(interviews, times(1)).findPage(
            any(), any(), any(), any(Boolean.class), anyInt(), any()
        );
    }

    @Test
    void calendarForwardsCompanyVisibilityFiltersAndOverlapWindow() {
        membership(CompanyMemberRole.MEMBER);
        when(interviews.findPage(
            any(),
            any(),
            any(),
            any(Boolean.class),
            anyInt(),
            any()
        )).thenReturn(List.of());

        service.calendar(
            recruiter(),
            RAW_TOKEN,
            new CalendarQuery(
                "2026-08-29T00:00:00Z",
                "2026-08-30T00:00:00Z",
                JOB_ID.toString(),
                CANDIDATE_ID.toString(),
                RECRUITER_ID.toString(),
                List.of("CONFIRMED", "SCHEDULED"),
                "10",
                null
            )
        );

        ArgumentCaptor<Filters> filters = ArgumentCaptor.forClass(Filters.class);
        verify(interviews).findPage(
            eq(Visibility.company(COMPANY_ID)),
            filters.capture(),
            eq(null),
            eq(true),
            eq(11),
            eq(NOW)
        );
        assertThat(filters.getValue().rangeStart()).isEqualTo(
            Instant.parse("2026-08-29T00:00:00Z")
        );
        assertThat(filters.getValue().rangeEnd()).isEqualTo(
            Instant.parse("2026-08-30T00:00:00Z")
        );
        assertThat(filters.getValue().jobId()).isEqualTo(JOB_ID);
        assertThat(filters.getValue().candidateId()).isEqualTo(CANDIDATE_ID);
        assertThat(filters.getValue().interviewerId()).isEqualTo(RECRUITER_ID);
        assertThat(filters.getValue().statuses()).containsExactly(
            InterviewStatus.SCHEDULED,
            InterviewStatus.CONFIRMED
        );
    }

    @Test
    void availabilityDerivesCandidateAndMergesActiveBusyHalfOpenIntervals() {
        when(applications.authorizeScheduling(
            APPLICATION_ID,
            "Bearer " + RAW_TOKEN
        )).thenReturn(applicationContext());
        Instant busyStart = Instant.parse("2026-08-29T02:15:00Z");
        Instant busyMiddle = Instant.parse("2026-08-29T02:45:00Z");
        Instant busyEnd = Instant.parse("2026-08-29T03:00:00Z");
        when(interviews.findBusyIntervals(
            RECRUITER_ID,
            CANDIDATE_ID,
            Instant.parse("2026-08-29T01:45:00Z"),
            Instant.parse("2026-08-29T04:00:00Z")
        )).thenReturn(List.of(
            new BusyInterval(busyMiddle, busyEnd),
            new BusyInterval(busyStart, busyMiddle)
        ));

        Availability result = service.availability(
            recruiter(),
            RAW_TOKEN,
            availabilityQuery(null, "50")
        );

        verify(applications).authorizeScheduling(
            APPLICATION_ID,
            "Bearer " + RAW_TOKEN
        );
        verifyNoInteractions(companies);
        assertThat(result.interviewerId()).isEqualTo(RECRUITER_ID);
        assertThat(result.applicationId()).isEqualTo(APPLICATION_ID);
        assertThat(result.stepMinutes()).isEqualTo(15);
        assertThat(result.slots()).contains(
            new Slot(
                Instant.parse("2026-08-29T01:45:00Z"),
                Instant.parse("2026-08-29T02:15:00Z")
            ),
            new Slot(
                Instant.parse("2026-08-29T03:00:00Z"),
                Instant.parse("2026-08-29T03:30:00Z")
            )
        );
        assertThat(result.slots()).allSatisfy(slot ->
            assertThat(
                slot.start().isBefore(busyEnd)
                    && slot.end().isAfter(busyStart)
            ).isFalse()
        );
    }

    @Test
    void availabilityCursorCannotCrossApplicationFilter() {
        when(applications.authorizeScheduling(any(), anyString()))
            .thenAnswer(invocation -> new ApplicationAuthorizationContext(
                invocation.getArgument(0),
                JOB_ID,
                COMPANY_ID,
                CANDIDATE_ID,
                "REVIEWING",
                7
            ));
        when(interviews.findBusyIntervals(any(), any(), any(), any()))
            .thenReturn(List.of());

        Availability first = service.availability(
            recruiter(),
            RAW_TOKEN,
            availabilityQuery(null, "1")
        );
        assertThat(first.nextCursor()).isNotBlank();

        AvailabilityQuery changed = new AvailabilityQuery(
            SECOND_APPLICATION_ID.toString(),
            "2026-08-29T08:45:00+07:00",
            "2026-08-29T11:00:00+07:00",
            "Asia/Ho_Chi_Minh",
            "30",
            "1",
            first.nextCursor()
        );
        assertCode(
            () -> service.availability(recruiter(), RAW_TOKEN, changed),
            "INTERVIEW_CURSOR_INVALID",
            HttpStatus.BAD_REQUEST
        );
        verify(interviews, times(1)).findBusyIntervals(
            any(), any(), any(), any()
        );
    }

    @Test
    void availabilityContinuationNeverReturnsSlotsThatBecamePast() {
        when(applications.authorizeScheduling(
            APPLICATION_ID,
            "Bearer " + RAW_TOKEN
        )).thenReturn(applicationContext());
        when(interviews.findBusyIntervals(any(), any(), any(), any()))
            .thenReturn(List.of());

        Availability first = service.availability(
            recruiter(),
            RAW_TOKEN,
            availabilityQuery(null, "1")
        );
        assertThat(first.slots()).containsExactly(new Slot(
            Instant.parse("2026-08-29T01:45:00Z"),
            Instant.parse("2026-08-29T02:15:00Z")
        ));

        Instant continuedAt = Instant.parse("2026-08-29T02:40:00Z");
        InterviewQueryService later = new InterviewQueryService(
            interviews,
            new InterviewCursorCodec(CURSOR_KEY),
            companies,
            applications,
            Clock.fixed(continuedAt, ZoneOffset.UTC)
        );
        Availability second = later.availability(
            recruiter(),
            RAW_TOKEN,
            availabilityQuery(first.nextCursor(), "1")
        );

        assertThat(second.asOf()).isEqualTo(first.asOf());
        assertThat(second.slots()).isNotEmpty().allSatisfy(slot ->
            assertThat(slot.start()).isAfterOrEqualTo(continuedAt)
        );
    }

    @Test
    void rejectsUnauthorizedRolesInvalidRangesOffsetsDurationsAndLimits() {
        assertCode(
            () -> service.calendar(
                candidate(),
                RAW_TOKEN,
                new CalendarQuery(
                    "2026-08-29T00:00:00Z",
                    "2026-08-30T00:00:00Z",
                    null, null, null, null, null, null
                )
            ),
            "INTERVIEW_ACCESS_DENIED",
            HttpStatus.FORBIDDEN
        );
        assertCode(
            () -> service.availability(
                candidate(),
                RAW_TOKEN,
                availabilityQuery(null, null)
            ),
            "INTERVIEW_ACCESS_DENIED",
            HttpStatus.FORBIDDEN
        );
        assertValidation(() -> service.availability(
            recruiter(),
            RAW_TOKEN,
            new AvailabilityQuery(
                APPLICATION_ID.toString(),
                "2026-08-29T08:45:00Z",
                "2026-08-29T11:00:00Z",
                "Asia/Ho_Chi_Minh",
                "30",
                null,
                null
            )
        ));
        assertValidation(() -> service.availability(
            recruiter(),
            RAW_TOKEN,
            new AvailabilityQuery(
                APPLICATION_ID.toString(),
                "2026-08-29T08:45:00+07:00",
                "2026-08-30T11:00:00+07:00",
                "Asia/Ho_Chi_Minh",
                "30",
                null,
                null
            )
        ));
        assertValidation(() -> service.availability(
            recruiter(),
            RAW_TOKEN,
            new AvailabilityQuery(
                APPLICATION_ID.toString(),
                "2026-08-29T08:45:00+07:00",
                "2026-08-29T11:00:00+07:00",
                "Asia/Ho_Chi_Minh",
                "31",
                null,
                null
            )
        ));
        assertValidation(() -> service.availability(
            recruiter(),
            RAW_TOKEN,
            new AvailabilityQuery(
                APPLICATION_ID.toString(),
                "2026-08-29T08:45:00+07:00",
                "2026-08-29T11:00:00+07:00",
                "+07:00",
                "30",
                null,
                null
            )
        ));
        assertValidation(() -> service.my(
            candidate(),
            RAW_TOKEN,
            new MyQuery("UPCOMING", null, null, null, "51", null)
        ));
        assertValidation(() -> service.calendar(
            recruiter(),
            RAW_TOKEN,
            new CalendarQuery(
                "2026-08-29T00:00:00Z",
                "2026-10-11T00:00:01Z",
                null, null, null, null, null, null
            )
        ));
        verifyNoInteractions(interviews, companies, applications);
    }

    private void membership(CompanyMemberRole role) {
        when(companies.resolve(RECRUITER_ID, RAW_TOKEN)).thenReturn(
            new RecruiterCompanyMembership(COMPANY_ID, role)
        );
    }

    private ApplicationAuthorizationContext applicationContext() {
        return new ApplicationAuthorizationContext(
            APPLICATION_ID,
            JOB_ID,
            COMPANY_ID,
            CANDIDATE_ID,
            "REVIEWING",
            7
        );
    }

    private AvailabilityQuery availabilityQuery(String cursor, String limit) {
        return new AvailabilityQuery(
            APPLICATION_ID.toString(),
            "2026-08-29T08:45:00+07:00",
            "2026-08-29T11:00:00+07:00",
            "Asia/Ho_Chi_Minh",
            "30",
            limit,
            cursor
        );
    }

    private InterviewReadRow row(
        UUID id,
        UUID candidateId,
        UUID interviewerId
    ) {
        return new InterviewReadRow(
            id,
            APPLICATION_ID,
            COMPANY_ID,
            JOB_ID,
            candidateId,
            interviewerId,
            interviewerId,
            2,
            1,
            Instant.parse("2026-08-29T02:00:00Z"),
            Instant.parse("2026-08-29T02:45:00Z"),
            "Asia/Ho_Chi_Minh",
            45,
            InterviewMode.OFFLINE,
            "Room 2",
            "Internal scorecard note",
            InterviewStatus.SCHEDULED,
            Instant.parse("2026-08-27T00:00:00Z"),
            Instant.parse("2026-08-27T01:00:00Z"),
            0
        );
    }

    private Viewer candidate() {
        return new Viewer(CANDIDATE_ID, ViewerRole.CANDIDATE);
    }

    private Viewer recruiter() {
        return new Viewer(RECRUITER_ID, ViewerRole.RECRUITER);
    }

    private void assertValidation(
        org.assertj.core.api.ThrowableAssert.ThrowingCallable action
    ) {
        assertCode(action, "VALIDATION_ERROR", HttpStatus.BAD_REQUEST);
    }

    private void assertCode(
        org.assertj.core.api.ThrowableAssert.ThrowingCallable action,
        String code,
        HttpStatus status
    ) {
        assertThatThrownBy(action)
            .isInstanceOfSatisfying(BusinessException.class, exception -> {
                assertThat(exception.code()).isEqualTo(code);
                assertThat(exception.status()).isEqualTo(status);
            });
    }

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }
}
