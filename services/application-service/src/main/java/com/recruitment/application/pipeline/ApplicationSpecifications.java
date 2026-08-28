package com.recruitment.application.pipeline;

import com.recruitment.application.domain.ApplicationEntity;
import com.recruitment.application.domain.ApplicationProfileSkillSnapshotEntity;
import com.recruitment.application.domain.ApplicationStatus;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;
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
        List<String> skills,
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
            if (!skills.isEmpty()) {
                predicates.add(skillMatch(root, query, criteria, skills));
            }
            if (!Long.class.equals(query.getResultType())) {
                applyOrder(root, query, criteria, sort);
            }
            return criteria.and(predicates.toArray(Predicate[]::new));
        };
    }

    private static Predicate skillMatch(
        Root<ApplicationEntity> application,
        jakarta.persistence.criteria.CriteriaQuery<?> query,
        jakarta.persistence.criteria.CriteriaBuilder criteria,
        List<String> skills
    ) {
        Subquery<Integer> matchingSkill = query.subquery(Integer.class);
        Root<ApplicationProfileSkillSnapshotEntity> snapshot =
            matchingSkill.from(ApplicationProfileSkillSnapshotEntity.class);
        Predicate[] requestedSkills = skills.stream()
            .map(skill -> criteria.equal(
                snapshot.<String>get("normalizedName"),
                criteria.lower(criteria.literal(skill))
            ))
            .toArray(Predicate[]::new);
        matchingSkill.select(criteria.literal(1)).where(
            criteria.equal(
                snapshot.<UUID>get("applicationId"),
                application.<UUID>get("id")
            ),
            criteria.or(requestedSkills)
        );
        return criteria.exists(matchingSkill);
    }

    private static void applyOrder(
        jakarta.persistence.criteria.Root<ApplicationEntity> root,
        jakarta.persistence.criteria.CriteriaQuery<?> query,
        jakarta.persistence.criteria.CriteriaBuilder criteria,
        ApplicationSort sort
    ) {
        switch (sort) {
            case APPLIED_AT_ASC -> query.orderBy(
                criteria.asc(root.get("appliedAt")),
                criteria.asc(root.get("id"))
            );
            case MATCH_SCORE_DESC -> query.orderBy(
                criteria.asc(criteria.isNull(root.get("matchScore"))),
                criteria.desc(root.get("matchScore")),
                criteria.desc(root.get("appliedAt")),
                criteria.desc(root.get("id"))
            );
            case APPLIED_AT_DESC -> query.orderBy(
                criteria.desc(root.get("appliedAt")),
                criteria.desc(root.get("id"))
            );
        }
    }
}
