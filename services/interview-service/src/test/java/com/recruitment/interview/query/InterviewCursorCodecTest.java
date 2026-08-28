package com.recruitment.interview.query;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.recruitment.interview.api.BusinessException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class InterviewCursorCodecTest {
    private static final String KEY =
        "cursor-test-key-with-at-least-thirty-two-bytes";
    private static final String PAGE_SCOPE = String.join(
        "\n",
        "history",
        "RECRUITER",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "MEMBER",
        "DESC",
        "20",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "-",
        "-",
        "-",
        "SCHEDULED"
    );
    private static final String SLOT_SCOPE = String.join(
        "\n",
        "availability",
        "RECRUITER",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "2026-09-10T02:00:00Z",
        "2026-09-10T10:00:00Z",
        "Asia/Ho_Chi_Minh",
        "45",
        "20"
    );
    private static final Instant AS_OF =
        Instant.parse("2026-08-28T14:20:00.123Z");
    private static final Instant POSITION =
        Instant.parse("2026-09-10T02:15:00.456Z");
    private static final UUID INTERVIEW_ID = UUID.fromString(
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    );

    private final InterviewCursorCodec codec = new InterviewCursorCodec(KEY);

    @Test
    void pageCursorRoundTripsExactMillisAndCanonicalUuidV4() {
        String encoded = codec.encodePage(
            PAGE_SCOPE,
            AS_OF,
            POSITION,
            INTERVIEW_ID
        );

        InterviewCursorCodec.PageCursor decoded = codec.decodePage(
            encoded,
            PAGE_SCOPE
        );

        assertThat(decoded.asOf()).isEqualTo(AS_OF);
        assertThat(decoded.position()).isEqualTo(POSITION);
        assertThat(decoded.id()).isEqualTo(INTERVIEW_ID);
        assertThat(decoded.id().version()).isEqualTo(4);
        assertThat(decoded.id().variant()).isEqualTo(2);
        assertThat(decoded.asOf().getNano() % 1_000_000).isZero();
        assertThat(decoded.position().getNano() % 1_000_000).isZero();
    }

    @Test
    void slotCursorRoundTripsExactMillis() {
        String encoded = codec.encodeSlot(SLOT_SCOPE, AS_OF, POSITION);

        InterviewCursorCodec.SlotCursor decoded = codec.decodeSlot(
            encoded,
            SLOT_SCOPE
        );

        assertThat(decoded.asOf()).isEqualTo(AS_OF);
        assertThat(decoded.position()).isEqualTo(POSITION);
    }

    @Test
    void encodingCanonicalizesSubMillisecondInstants() {
        Instant subMillisecondAsOf = Instant.parse(
            "2026-08-28T14:20:00.123999999Z"
        );
        Instant subMillisecondPosition = Instant.parse(
            "2026-09-10T02:15:00.456999999Z"
        );

        InterviewCursorCodec.PageCursor decoded = codec.decodePage(
            codec.encodePage(
                PAGE_SCOPE,
                subMillisecondAsOf,
                subMillisecondPosition,
                INTERVIEW_ID
            ),
            PAGE_SCOPE
        );

        assertThat(decoded.asOf()).isEqualTo(
            Instant.ofEpochMilli(subMillisecondAsOf.toEpochMilli())
        );
        assertThat(decoded.position()).isEqualTo(
            Instant.ofEpochMilli(subMillisecondPosition.toEpochMilli())
        );
    }

    @Test
    void rejectsPayloadAndSignatureTampering() {
        String encoded = codec.encodePage(
            PAGE_SCOPE,
            AS_OF,
            POSITION,
            INTERVIEW_ID
        );
        int separator = encoded.indexOf('.');
        String payloadTampered = flip(encoded, separator / 2);
        String signatureTampered = flip(
            encoded,
            separator + 1 + (encoded.length() - separator - 1) / 2
        );

        assertInvalid(() -> codec.decodePage(payloadTampered, PAGE_SCOPE));
        assertInvalid(() -> codec.decodePage(signatureTampered, PAGE_SCOPE));
    }

    @Test
    void rejectsTruncatedMalformedAndInvalidBase64Tokens() {
        String encoded = codec.encodePage(
            PAGE_SCOPE,
            AS_OF,
            POSITION,
            INTERVIEW_ID
        );
        List<String> invalid = List.of(
            encoded.substring(0, encoded.length() - 1),
            signedToken("1\nPAGE"),
            "***.***",
            "a=bc.def",
            ".signature",
            "payload.",
            "payload.signature.extra"
        );

        invalid.forEach(cursor ->
            assertInvalid(() -> codec.decodePage(cursor, PAGE_SCOPE))
        );
    }

    @Test
    void rejectsOversizedCursorAndSignedPayload() {
        String cursorTooLong = "a".repeat(
            InterviewCursorCodec.MAX_CURSOR_LENGTH + 1
        );
        String payloadTooLarge = signedToken("x".repeat(513));

        assertInvalid(() -> codec.decodePage(cursorTooLong, PAGE_SCOPE));
        assertThat(payloadTooLarge.length()).isLessThanOrEqualTo(
            InterviewCursorCodec.MAX_CURSOR_LENGTH
        );
        assertInvalid(() -> codec.decodePage(payloadTooLarge, PAGE_SCOPE));
    }

    @Test
    void rejectsCrossScopeAndCrossEndpointCursorUse() {
        String page = codec.encodePage(
            PAGE_SCOPE,
            AS_OF,
            POSITION,
            INTERVIEW_ID
        );
        String slot = codec.encodeSlot(SLOT_SCOPE, AS_OF, POSITION);

        assertInvalid(() -> codec.decodePage(page, "calendar\n" + PAGE_SCOPE));
        assertInvalid(() -> codec.decodeSlot(page, PAGE_SCOPE));
        assertInvalid(() -> codec.decodePage(slot, SLOT_SCOPE));
    }

    @Test
    void rejectsCursorReusedByAnotherUserOrWithAnotherFilter() {
        String encoded = codec.encodePage(
            PAGE_SCOPE,
            AS_OF,
            POSITION,
            INTERVIEW_ID
        );
        String anotherUser = PAGE_SCOPE.replace(
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "ffffffff-ffff-4fff-8fff-ffffffffffff"
        );
        String anotherFilter = PAGE_SCOPE.replace("SCHEDULED", "CONFIRMED");

        assertInvalid(() -> codec.decodePage(encoded, anotherUser));
        assertInvalid(() -> codec.decodePage(encoded, anotherFilter));
    }

    @Test
    void rejectsNonCanonicalOrNonV4PageIdentity() {
        UUID versionOne = UUID.fromString(
            "eeeeeeee-eeee-1eee-8eee-eeeeeeeeeeee"
        );
        UUID nonRfcVariant = UUID.fromString(
            "eeeeeeee-eeee-4eee-1eee-eeeeeeeeeeee"
        );
        String uppercaseIdentity = signedCursor(
            "PAGE",
            PAGE_SCOPE,
            AS_OF,
            POSITION,
            INTERVIEW_ID.toString().toUpperCase()
        );

        assertInvalid(() -> codec.decodePage(
            codec.encodePage(PAGE_SCOPE, AS_OF, POSITION, versionOne),
            PAGE_SCOPE
        ));
        assertInvalid(() -> codec.decodePage(
            codec.encodePage(PAGE_SCOPE, AS_OF, POSITION, nonRfcVariant),
            PAGE_SCOPE
        ));
        assertInvalid(() -> codec.decodePage(uppercaseIdentity, PAGE_SCOPE));
    }

    @Test
    void rejectsNegativeEpochMillis() {
        String encoded = codec.encodeSlot(
            SLOT_SCOPE,
            Instant.ofEpochMilli(-1),
            POSITION
        );

        assertInvalid(() -> codec.decodeSlot(encoded, SLOT_SCOPE));
    }

    @Test
    void rejectsUnsafeHmacKeysAndAcceptsExactMinimumLength() {
        List<String> invalidKeys = java.util.Arrays.asList(
            null,
            "too-short",
            " " + "a".repeat(32),
            "a".repeat(32) + "\n",
            "REPLACE-WITH-A-REAL-CURSOR-SECRET-123456789"
        );

        invalidKeys.forEach(key ->
            assertThatThrownBy(() -> new InterviewCursorCodec(key))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("INTERVIEW_CURSOR_HMAC_KEY")
        );
        assertThat(new InterviewCursorCodec("k".repeat(32))).isNotNull();
    }

    private void assertInvalid(Runnable decoding) {
        assertThatThrownBy(decoding::run)
            .isInstanceOfSatisfying(BusinessException.class, exception -> {
                assertThat(exception.code()).isEqualTo(
                    "INTERVIEW_CURSOR_INVALID"
                );
                assertThat(exception.status()).isEqualTo(HttpStatus.BAD_REQUEST);
                assertThat(exception.getMessage()).isEqualTo(
                    "Pagination cursor is invalid for this query"
                );
            });
    }

    private String signedCursor(
        String kind,
        String scope,
        Instant asOf,
        Instant position,
        String identity
    ) {
        String payload = String.join(
            "\n",
            "1",
            kind,
            sha256(scope),
            Long.toString(asOf.toEpochMilli()),
            Long.toString(position.toEpochMilli()),
            identity
        );
        return signedToken(payload);
    }

    private String signedToken(String payload) {
        byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
        Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
        return encoder.encodeToString(bytes) + "." +
            encoder.encodeToString(hmac(bytes));
    }

    private String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                value.getBytes(StandardCharsets.UTF_8)
            );
            return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(digest);
        } catch (GeneralSecurityException exception) {
            throw new AssertionError(exception);
        }
    }

    private byte[] hmac(byte[] payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(
                KEY.getBytes(StandardCharsets.UTF_8),
                "HmacSHA256"
            ));
            return mac.doFinal(payload);
        } catch (GeneralSecurityException exception) {
            throw new AssertionError(exception);
        }
    }

    private String flip(String value, int index) {
        char current = value.charAt(index);
        char replacement = current == 'A' ? 'B' : 'A';
        return value.substring(0, index) + replacement +
            value.substring(index + 1);
    }
}
