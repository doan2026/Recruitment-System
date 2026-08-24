package com.recruitment.application.pipeline;

import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationStatus;
import jakarta.persistence.criteria.Predicate;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.domain.Specification;

final class ApplicationSpecifications {
    private ApplicationSpecifications() {}

    static Specification<ApplicationEntity> recruiterFilter(
        UUID companyId,
        UUID jobId,
        ApplicationStatus status,
        Instant appliedFrom,
        Instant appliedTo,
        ApplicationSort sort
    ) {
        return (root, query, criteria) -> {
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(criteria.equal(root.get("companyId"), companyId));
            if (jobId != null) {
                predicates.add(criteria.equal(root.get("jobId"), jobId));
            }
            if (status != null) {
                predicates.add(criteria.equal(root.get("status"), status));
            }
            if (appliedFrom != null) {
                predicates.add(criteria.greaterThanOrEqualTo(
                    root.get("appliedAt"),
                    appliedFrom
                ));
            }
            if (appliedTo != null) {
                predicates.add(criteria.lessThanOrEqualTo(
                    root.get("appliedAt"),
                    appliedTo
                ));
            }
            if (!Long.class.equals(query.getResultType())) {
                applyOrder(root, query, criteria, sort);
            }
            return criteria.and(predicates.toArray(Predicate[]::new));
        };
    }

    private static void applyOrder(
        jakarta.persistence.criteria.Root<ApplicationEntity> root,
        jakarta.persistence.criteria.CriteriaQuery<?> query,
        jakarta.persistence.criteria.CriteriaBuilder criteria,
        ApplicationSort sort
    ) {
        switch (sort) {
            case APPLIED_AT_ASC -> query.orderBy(
                criteria.asc(root.get("appliedAt"))
            );
            case MATCH_SCORE_DESC -> query.orderBy(
                criteria.asc(criteria.isNull(root.get("matchScore"))),
                criteria.desc(root.get("matchScore")),
                criteria.desc(root.get("appliedAt"))
            );
            case APPLIED_AT_DESC -> query.orderBy(
                criteria.desc(root.get("appliedAt"))
            );
        }
    }
}
