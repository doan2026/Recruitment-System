package com.recruitment.application.usage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import com.recruitment.application.api.BusinessException;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;

class CvUsageLookupServiceTest {
    private static final UUID V4_ID = UUID.fromString(
        "10000000-0000-4000-8000-000000000001"
    );
    private static final UUID V1_ID = UUID.fromString(
        "10000000-0000-1000-8000-000000000001"
    );

    @Test
    void rejectsNonV4ContractIdsBeforeDatabaseLookup() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        CvUsageLookupService service = new CvUsageLookupService(jdbc);

        assertInvalid(() -> service.lookup(
            new CvUsageLookupRequest(V1_ID, V4_ID)
        ));
        assertInvalid(() -> service.lookup(
            new CvUsageLookupRequest(V4_ID, V1_ID)
        ));

        verifyNoInteractions(jdbc);
    }

    private void assertInvalid(
        org.assertj.core.api.ThrowableAssert.ThrowingCallable call
    ) {
        assertThatThrownBy(call)
            .isInstanceOf(BusinessException.class)
            .satisfies(error -> {
                BusinessException business = (BusinessException) error;
                assertThat(business.code())
                    .isEqualTo("INVALID_CV_USAGE_REQUEST");
                assertThat(business.status())
                    .isEqualTo(HttpStatus.BAD_REQUEST);
            });
    }
}
