package com.recruitment.application.pipeline;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.recruitment.application.api.BusinessException;
import java.util.List;
import org.junit.jupiter.api.Test;

class ApplicationSkillFilterTest {
    @Test
    void parsesRepeatedAndCommaSeparatedValuesWithNfkcAndTrim() {
        assertThat(ApplicationSkillFilter.parse(List.of(
            "  Ｊａｖａ , Spring Boot  ",
            "Kotlin"
        ))).containsExactly("Java", "Spring Boot", "Kotlin");
    }

    @Test
    void absentFilterProducesAnEmptyImmutableList() {
        assertThat(ApplicationSkillFilter.parse(null)).isEmpty();
        assertThat(ApplicationSkillFilter.parse(List.of())).isEmpty();
        assertThatThrownBy(() -> ApplicationSkillFilter.parse(
            List.of("Java")
        ).add("Kotlin")).isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void rejectsMoreThanTenValuesAfterSplitting() {
        assertInvalid(List.of(
            "one,two,three,four,five,six,seven,eight,nine,ten,eleven"
        ));
    }

    @Test
    void rejectsBlankSegments() {
        assertInvalid(List.of("Java,,Kotlin"));
        assertInvalid(List.of("   "));
    }

    @Test
    void rejectsControlCharacters() {
        assertInvalid(List.of("Java\nScript"));
        assertInvalid(List.of("Java\n"));
        assertInvalid(List.of("\tJava"));
    }

    @Test
    void enforcesLengthInUnicodeCodePoints() {
        String emoji = "🧠";
        assertThat(ApplicationSkillFilter.parse(List.of(
            emoji.repeat(ApplicationSkillFilter.MAX_SKILL_LENGTH)
        ))).hasSize(1);
        assertInvalid(List.of(
            emoji.repeat(ApplicationSkillFilter.MAX_SKILL_LENGTH + 1)
        ));
    }

    @Test
    void rejectsCaseInsensitiveDuplicatesAfterNormalization() {
        assertInvalid(List.of("Ｊａｖａ", "java"));
    }

    private void assertInvalid(List<String> values) {
        assertThatThrownBy(() -> ApplicationSkillFilter.parse(values))
            .isInstanceOf(BusinessException.class)
            .extracting("code")
            .isEqualTo("INVALID_SKILL_FILTER");
    }
}
