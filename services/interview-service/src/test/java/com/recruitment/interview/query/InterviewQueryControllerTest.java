package com.recruitment.interview.query;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.ImportSelector;
import org.springframework.core.type.AnnotationMetadata;
import org.springframework.http.HttpHeaders;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

@WebMvcTest(
    controllers = InterviewQueryController.class,
    properties = {
        "CORS_ORIGINS=http://localhost:3000",
        "JWT_PUBLIC_KEY_PATH=/tmp/interview-query-controller-test-public.pem"
    }
)
@Import(InterviewQueryControllerTest.InterviewSecurityImport.class)
class InterviewQueryControllerTest {
    private static final UUID CANDIDATE_ID = UUID.fromString(
        "123e4567-e89b-42d3-a456-426614174000"
    );
    private static final UUID RECRUITER_ID = UUID.fromString(
        "223e4567-e89b-42d3-a456-426614174000"
    );
    private static final UUID INTERVIEW_ID = UUID.fromString(
        "323e4567-e89b-42d3-a456-426614174000"
    );
    private static final UUID APPLICATION_ID = UUID.fromString(
        "423e4567-e89b-42d3-a456-426614174000"
    );
    private static final UUID COMPANY_ID = UUID.fromString(
        "523e4567-e89b-42d3-a456-426614174000"
    );
    private static final UUID JOB_ID = UUID.fromString(
        "623e4567-e89b-42d3-a456-426614174000"
    );
    private static final Instant START = Instant.parse(
        "2026-09-10T02:00:00.000Z"
    );
    private static final Instant END = Instant.parse(
        "2026-09-10T02:45:00.000Z"
    );
    private static final Instant AS_OF = Instant.parse(
        "2026-08-28T16:00:00.000Z"
    );

    @Autowired
    private MockMvc mvc;

    @MockBean
    private InterviewQueryService queries;

    @MockBean
    private JwtDecoder jwtDecoder;

    @Test
    void candidateReadsApplicationHistoryWithPrivateShapeAndHeaders()
        throws Exception {
        HistoryQuery query = new HistoryQuery(
            APPLICATION_ID.toString(),
            null,
            null,
            null,
            List.of("SCHEDULED"),
            "20",
            null
        );
        when(queries.history(
            new Viewer(CANDIDATE_ID, ViewerRole.CANDIDATE),
            "candidate-access-token",
            query
        )).thenReturn(candidatePage());

        ResultActions result = mvc.perform(get("/interviews")
            .with(candidate())
            .param("applicationId", APPLICATION_ID.toString())
            .param("status", "SCHEDULED")
            .param("limit", "20"));

        expectPrivateOk(result)
            .andExpect(jsonPath("$.data.items[0].id").value(INTERVIEW_ID.toString()))
            .andExpect(jsonPath("$.data.items[0].applicationId")
                .value(APPLICATION_ID.toString()))
            .andExpect(jsonPath("$.data.items[0].status").value("SCHEDULED"))
            .andExpect(jsonPath("$.data.items[0].notes").doesNotExist())
            .andExpect(jsonPath("$.data.items[0].companyId").doesNotExist())
            .andExpect(jsonPath("$.data.asOf").value(AS_OF.toString()));
        verify(queries).history(
            new Viewer(CANDIDATE_ID, ViewerRole.CANDIDATE),
            "candidate-access-token",
            query
        );
    }

    @Test
    void recruiterReadsMyPastInterviews() throws Exception {
        MyQuery query = new MyQuery(
            "PAST",
            null,
            null,
            null,
            "10",
            "signed-cursor"
        );
        when(queries.my(
            new Viewer(RECRUITER_ID, ViewerRole.RECRUITER),
            "recruiter-access-token",
            query
        )).thenReturn(recruiterPage());

        ResultActions result = mvc.perform(get("/interviews/my")
            .with(recruiter())
            .param("period", "PAST")
            .param("limit", "10")
            .param("cursor", "signed-cursor"));

        expectPrivateOk(result)
            .andExpect(jsonPath("$.data.items[0].interviewerId")
                .value(RECRUITER_ID.toString()))
            .andExpect(jsonPath("$.data.items[0].notes").doesNotExist())
            .andExpect(jsonPath("$.data.nextCursor").value("next-page"));
        verify(queries).my(
            new Viewer(RECRUITER_ID, ViewerRole.RECRUITER),
            "recruiter-access-token",
            query
        );
    }

    @Test
    void recruiterReadsCompanyCalendarWithRepeatedStatusFilters()
        throws Exception {
        CalendarQuery query = new CalendarQuery(
            "2026-09-01T00:00:00.000Z",
            "2026-09-30T00:00:00.000Z",
            JOB_ID.toString(),
            null,
            RECRUITER_ID.toString(),
            List.of("SCHEDULED", "CONFIRMED"),
            "50",
            null
        );
        when(queries.calendar(
            new Viewer(RECRUITER_ID, ViewerRole.RECRUITER),
            "recruiter-access-token",
            query
        )).thenReturn(recruiterPage());

        ResultActions result = mvc.perform(get("/interviews/calendar")
            .with(recruiter())
            .param("from", "2026-09-01T00:00:00.000Z")
            .param("to", "2026-09-30T00:00:00.000Z")
            .param("jobId", JOB_ID.toString())
            .param("interviewerId", RECRUITER_ID.toString())
            .param("status", "SCHEDULED", "CONFIRMED")
            .param("limit", "50"));

        expectPrivateOk(result)
            .andExpect(jsonPath("$.data.items[0].companyId")
                .value(COMPANY_ID.toString()))
            .andExpect(jsonPath("$.data.items[0].notes").doesNotExist());
        verify(queries).calendar(
            new Viewer(RECRUITER_ID, ViewerRole.RECRUITER),
            "recruiter-access-token",
            query
        );
    }

    @Test
    void recruiterReadsAdvisoryAvailabilityWithoutBusyDetails()
        throws Exception {
        AvailabilityQuery query = new AvailabilityQuery(
            APPLICATION_ID.toString(),
            "2026-09-10T09:00:00.000+07:00",
            "2026-09-10T12:00:00.000+07:00",
            "Asia/Ho_Chi_Minh",
            "45",
            "20",
            null
        );
        when(queries.availability(
            new Viewer(RECRUITER_ID, ViewerRole.RECRUITER),
            "recruiter-access-token",
            query
        )).thenReturn(availability());

        ResultActions result = mvc.perform(get("/interviews/availability")
            .with(recruiter())
            .param("applicationId", APPLICATION_ID.toString())
            .param("from", "2026-09-10T09:00:00.000+07:00")
            .param("to", "2026-09-10T12:00:00.000+07:00")
            .param("timeZone", "Asia/Ho_Chi_Minh")
            .param("durationMinutes", "45")
            .param("limit", "20"));

        expectPrivateOk(result)
            .andExpect(jsonPath("$.data.applicationId")
                .value(APPLICATION_ID.toString()))
            .andExpect(jsonPath("$.data.interviewerId")
                .value(RECRUITER_ID.toString()))
            .andExpect(jsonPath("$.data.slots[0].start").value(START.toString()))
            .andExpect(jsonPath("$.data.slots[0].end").value(END.toString()))
            .andExpect(jsonPath("$.data.items").doesNotExist())
            .andExpect(jsonPath("$.data.candidateId").doesNotExist());
        verify(queries).availability(
            new Viewer(RECRUITER_ID, ViewerRole.RECRUITER),
            "recruiter-access-token",
            query
        );
    }

    @Test
    void recruiterReadsDetailWithAuthorizedInternalNotes() throws Exception {
        when(queries.detail(
            new Viewer(RECRUITER_ID, ViewerRole.RECRUITER),
            "recruiter-access-token",
            INTERVIEW_ID.toString()
        )).thenReturn(recruiterDetail());

        ResultActions result = mvc.perform(get("/interviews/{id}", INTERVIEW_ID)
            .with(recruiter()));

        expectPrivateOk(result)
            .andExpect(jsonPath("$.data.id").value(INTERVIEW_ID.toString()))
            .andExpect(jsonPath("$.data.scheduledBy")
                .value(RECRUITER_ID.toString()))
            .andExpect(jsonPath("$.data.notes").value("Internal scorecard prep"))
            .andExpect(jsonPath("$.data.requestId").doesNotExist())
            .andExpect(jsonPath("$.data.requestHash").doesNotExist());
        verify(queries).detail(
            new Viewer(RECRUITER_ID, ViewerRole.RECRUITER),
            "recruiter-access-token",
            INTERVIEW_ID.toString()
        );
    }

    @Test
    void candidateCanReadMyInterviews() throws Exception {
        MyQuery query = new MyQuery(null, null, null, null, null, null);
        when(queries.my(
            new Viewer(CANDIDATE_ID, ViewerRole.CANDIDATE),
            "candidate-access-token",
            query
        )).thenReturn(candidatePage());

        expectPrivateOk(mvc.perform(get("/interviews/my").with(candidate())))
            .andExpect(jsonPath("$.data.items[0].candidateId").doesNotExist());
        verify(queries).my(
            new Viewer(CANDIDATE_ID, ViewerRole.CANDIDATE),
            "candidate-access-token",
            query
        );
    }

    @Test
    void candidateCanReadRelatedDetailWithoutRecruiterOnlyFields()
        throws Exception {
        when(queries.detail(
            new Viewer(CANDIDATE_ID, ViewerRole.CANDIDATE),
            "candidate-access-token",
            INTERVIEW_ID.toString()
        )).thenReturn(candidateItem());

        expectPrivateOk(mvc.perform(get("/interviews/{id}", INTERVIEW_ID)
                .with(candidate())))
            .andExpect(jsonPath("$.data.location").value("Meeting room 2"))
            .andExpect(jsonPath("$.data.notes").doesNotExist())
            .andExpect(jsonPath("$.data.scheduledBy").doesNotExist());
        verify(queries).detail(
            new Viewer(CANDIDATE_ID, ViewerRole.CANDIDATE),
            "candidate-access-token",
            INTERVIEW_ID.toString()
        );
    }

    @ParameterizedTest
    @MethodSource("recruiterOnlyPaths")
    void candidateCannotInvokeRecruiterOnlyMethods(String path)
        throws Exception {
        mvc.perform(get(path).with(candidate()))
            .andExpect(status().isForbidden())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
            .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
        verifyNoInteractions(queries);
    }

    @ParameterizedTest
    @MethodSource("allQueryPaths")
    void adminCannotInvokeInterviewQueryMethods(String path) throws Exception {
        mvc.perform(get(path).with(admin()))
            .andExpect(status().isForbidden())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
            .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
        verifyNoInteractions(queries);
    }

    @ParameterizedTest
    @MethodSource("allQueryPaths")
    void anonymousCallerIsRejectedBeforeQueryServiceRuns(String path)
        throws Exception {
        mvc.perform(get(path))
            .andExpect(status().isUnauthorized())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
            .andExpect(header().string(HttpHeaders.WWW_AUTHENTICATE, "Bearer"))
            .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
        verifyNoInteractions(queries);
    }

    @Test
    void unknownQueryParameterIsRejectedBeforeQueryServiceRuns()
        throws Exception {
        mvc.perform(get("/interviews")
                .with(candidate())
                .param("applicationId", APPLICATION_ID.toString())
                .param("companyId", COMPANY_ID.toString()))
            .andExpect(status().isBadRequest())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
            .andExpect(jsonPath("$.details.query").exists());
        verifyNoInteractions(queries);
    }

    @Test
    void repeatedScalarParameterIsRejectedBeforeQueryServiceRuns()
        throws Exception {
        mvc.perform(get("/interviews/my")
                .with(recruiter())
                .param("period", "UPCOMING", "PAST"))
            .andExpect(status().isBadRequest())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        verifyNoInteractions(queries);
    }

    @Test
    void detailRejectsEveryQueryParameterBeforeQueryServiceRuns()
        throws Exception {
        mvc.perform(get("/interviews/{id}", INTERVIEW_ID)
                .with(candidate())
                .param("includeNotes", "true"))
            .andExpect(status().isBadRequest())
            .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")))
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        verifyNoInteractions(queries);
    }

    private static ResultActions expectPrivateOk(ResultActions result)
        throws Exception {
        return result
            .andExpect(status().isOk())
            .andExpect(header().string(
                HttpHeaders.CACHE_CONTROL,
                containsString("private")
            ))
            .andExpect(header().string(
                HttpHeaders.CACHE_CONTROL,
                containsString("no-store")
            ))
            .andExpect(header().string(HttpHeaders.PRAGMA, "no-cache"))
            .andExpect(header().stringValues(
                HttpHeaders.VARY,
                hasItem(HttpHeaders.AUTHORIZATION)
            ));
    }

    private static Page candidatePage() {
        return new Page(List.of(candidateItem()), null, AS_OF);
    }

    private static Page recruiterPage() {
        return new Page(List.of(recruiterSummary()), "next-page", AS_OF);
    }

    private static Item candidateItem() {
        return new Item(
            INTERVIEW_ID,
            APPLICATION_ID,
            null,
            JOB_ID,
            null,
            null,
            null,
            1,
            1,
            START,
            END,
            "Asia/Ho_Chi_Minh",
            45,
            InterviewMode.OFFLINE,
            "Meeting room 2",
            null,
            InterviewStatus.SCHEDULED,
            null,
            null,
            0
        );
    }

    private static Item recruiterSummary() {
        return new Item(
            INTERVIEW_ID,
            APPLICATION_ID,
            COMPANY_ID,
            JOB_ID,
            CANDIDATE_ID,
            RECRUITER_ID,
            null,
            1,
            1,
            START,
            END,
            "Asia/Ho_Chi_Minh",
            45,
            InterviewMode.OFFLINE,
            "Meeting room 2",
            null,
            InterviewStatus.SCHEDULED,
            null,
            null,
            0
        );
    }

    private static Item recruiterDetail() {
        return new Item(
            INTERVIEW_ID,
            APPLICATION_ID,
            COMPANY_ID,
            JOB_ID,
            CANDIDATE_ID,
            RECRUITER_ID,
            RECRUITER_ID,
            1,
            1,
            START,
            END,
            "Asia/Ho_Chi_Minh",
            45,
            InterviewMode.OFFLINE,
            "Meeting room 2",
            "Internal scorecard prep",
            InterviewStatus.SCHEDULED,
            AS_OF.minusSeconds(3600),
            AS_OF.minusSeconds(1800),
            0
        );
    }

    private static Availability availability() {
        return new Availability(
            APPLICATION_ID,
            RECRUITER_ID,
            START,
            Instant.parse("2026-09-10T05:00:00.000Z"),
            "Asia/Ho_Chi_Minh",
            45,
            15,
            List.of(new Slot(START, END)),
            null,
            AS_OF
        );
    }

    private static RequestPostProcessor candidate() {
        return identity(CANDIDATE_ID, "CANDIDATE", "candidate-access-token");
    }

    private static RequestPostProcessor recruiter() {
        return identity(RECRUITER_ID, "RECRUITER", "recruiter-access-token");
    }

    private static RequestPostProcessor admin() {
        return identity(
            UUID.fromString("723e4567-e89b-42d3-a456-426614174000"),
            "ADMIN",
            "admin-access-token"
        );
    }

    private static RequestPostProcessor identity(
        UUID id,
        String role,
        String token
    ) {
        return jwt()
            .jwt(jwt -> jwt
                .tokenValue(token)
                .subject(id.toString())
                .claim("role", role))
            .authorities(new SimpleGrantedAuthority("ROLE_" + role));
    }

    private static Stream<String> recruiterOnlyPaths() {
        return Stream.of(
            "/interviews/calendar",
            "/interviews/availability"
        );
    }

    private static Stream<String> allQueryPaths() {
        return Stream.of(
            "/interviews",
            "/interviews/my",
            "/interviews/calendar",
            "/interviews/availability",
            "/interviews/" + INTERVIEW_ID
        );
    }

    static final class InterviewSecurityImport implements ImportSelector {
        @Override
        public String[] selectImports(
            AnnotationMetadata importingClassMetadata
        ) {
            return new String[] {
                "com.recruitment.interview.config.SecurityConfig"
            };
        }
    }
}
