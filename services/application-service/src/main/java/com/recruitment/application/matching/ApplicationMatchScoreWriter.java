package com.recruitment.application.matching;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.repository.ApplicationRepository;
import java.math.BigDecimal;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ApplicationMatchScoreWriter {
    private final ApplicationRepository applications;

    public ApplicationMatchScoreWriter(ApplicationRepository applications) {
        this.applications = applications;
    }

    @Transactional
    public ApplicationMatchScoreResponse update(
        UUID applicationId,
        BigDecimal matchScore,
        long expectedVersion
    ) {
        int changed = applications.updateMatchScore(
            applicationId,
            matchScore,
            expectedVersion
        );
        if (changed != 1) {
            throw new BusinessException(
                "APPLICATION_CHANGED_CONCURRENTLY",
                "Application changed concurrently; reload and try again",
                HttpStatus.CONFLICT
            );
        }
        return new ApplicationMatchScoreResponse(
            applicationId,
            matchScore,
            expectedVersion + 1
        );
    }
}
