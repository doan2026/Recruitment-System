package com.recruitment.application.pipeline;

import com.recruitment.application.api.BusinessException;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.http.HttpStatus;

final class ApplicationSkillFilter {
    static final int MAX_SKILLS = 10;
    static final int MAX_SKILL_LENGTH = 120;

    private ApplicationSkillFilter() {}

    static List<String> parse(List<String> rawValues) {
        if (rawValues == null || rawValues.isEmpty()) {
            return List.of();
        }

        List<String> splitValues = new ArrayList<>();
        for (String rawValue : rawValues) {
            if (rawValue == null) {
                splitValues.add("");
                continue;
            }
            splitValues.addAll(List.of(rawValue.split(",", -1)));
        }
        if (splitValues.size() > MAX_SKILLS) {
            throw invalid(
                "At most " + MAX_SKILLS + " skills can be filtered at once"
            );
        }

        List<String> normalized = new ArrayList<>(splitValues.size());
        Set<String> normalizedKeys = new HashSet<>();
        for (String value : splitValues) {
            String normalizedValue = Normalizer.normalize(
                value,
                Normalizer.Form.NFKC
            );
            if (normalizedValue.codePoints().anyMatch(
                Character::isISOControl
            )) {
                throw invalid("Skill filters must not contain control characters");
            }
            String skill = normalizedValue.strip();
            if (skill.isEmpty()) {
                throw invalid("Skill filters must not be blank");
            }
            if (skill.codePointCount(0, skill.length()) > MAX_SKILL_LENGTH) {
                throw invalid(
                    "Each skill filter must be at most " +
                    MAX_SKILL_LENGTH +
                    " characters"
                );
            }
            if (!normalizedKeys.add(skill.toLowerCase(Locale.ROOT))) {
                throw invalid("Skill filters must not contain duplicates");
            }
            normalized.add(skill);
        }
        return List.copyOf(normalized);
    }

    private static BusinessException invalid(String message) {
        return new BusinessException(
            "INVALID_SKILL_FILTER",
            message,
            HttpStatus.BAD_REQUEST
        );
    }
}
