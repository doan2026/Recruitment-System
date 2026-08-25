package com.recruitment.application.matching;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.repository.ApplicationRepository;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class ApplicationMatchScoreWriterTest {
    private static final UUID APPLICATION_ID = UUID.fromString(
        "10000000-0000-0000-0000-000000000001"
    );
    private final ApplicationRepository applications =
        mock(ApplicationRepository.class);
    private final ApplicationMatchScoreWriter writer =
        new ApplicationMatchScoreWriter(applications);

    @Test
    void returnsTheIncrementedAggregateVersionAfterAtomicUpdate() {
        BigDecimal score = new BigDecimal("85.46");
        when(applications.updateMatchScore(APPLICATION_ID, score, 4L))
            .thenReturn(1);

        ApplicationMatchScoreResponse response = writer.update(
            APPLICATION_ID,
            score,
            4L
        );

        assertThat(response.applicationId()).isEqualTo(APPLICATION_ID);
        assertThat(response.matchScore()).isEqualByComparingTo("85.46");
        assertThat(response.version()).isEqualTo(5L);
    }

    @Test
    void zeroUpdatedRowsMeansTheAggregateChangedConcurrently() {
        BigDecimal score = new BigDecimal("85.46");
        when(applications.updateMatchScore(APPLICATION_ID, score, 4L))
            .thenReturn(0);

        assertThatThrownBy(() -> writer.update(
            APPLICATION_ID,
            score,
            4L
        ))
            .isInstanceOf(BusinessException.class)
            .satisfies(error -> {
                BusinessException businessError = (BusinessException) error;
                assertThat(businessError.code())
                    .isEqualTo("APPLICATION_CHANGED_CONCURRENTLY");
                assertThat(businessError.status())
                    .isEqualTo(HttpStatus.CONFLICT);
            });
    }
}
