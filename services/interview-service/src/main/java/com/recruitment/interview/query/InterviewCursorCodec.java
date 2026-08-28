package com.recruitment.interview.query;

import com.recruitment.interview.api.BusinessException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.DateTimeException;
import java.time.Instant;
import java.util.Base64;
import java.util.Locale;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class InterviewCursorCodec {
    static final int MAX_CURSOR_LENGTH = 1024;
    private static final int MAX_PAYLOAD_BYTES = 512;
    private static final Base64.Encoder ENCODER =
        Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();

    private final byte[] key;

    public InterviewCursorCodec(
        @Value("${interview.query.cursor-hmac-key}") String configuredKey
    ) {
        byte[] bytes = configuredKey == null
            ? new byte[0]
            : configuredKey.getBytes(StandardCharsets.UTF_8);
        if (
            bytes.length < 32 ||
            !configuredKey.equals(configuredKey.trim()) ||
            configuredKey.toLowerCase(Locale.ROOT).contains("replace-with") ||
            configuredKey.chars().anyMatch(Character::isISOControl)
        ) {
            throw new IllegalStateException(
                "INTERVIEW_CURSOR_HMAC_KEY must be a non-placeholder key " +
                "of at least 32 bytes"
            );
        }
        this.key = bytes.clone();
    }

    public String encodePage(
        String scope,
        Instant asOf,
        Instant position,
        UUID id
    ) {
        return encode("PAGE", scope, asOf, position, id.toString());
    }

    public PageCursor decodePage(String cursor, String scope) {
        CursorState state = decode(cursor, "PAGE", scope);
        UUID id;
        try {
            id = UUID.fromString(state.identity());
        } catch (RuntimeException exception) {
            throw invalid();
        }
        if (
            id.version() != 4 ||
            id.variant() != 2 ||
            !id.toString().equals(state.identity())
        ) {
            throw invalid();
        }
        return new PageCursor(state.asOf(), state.position(), id);
    }

    public String encodeSlot(
        String scope,
        Instant asOf,
        Instant position
    ) {
        return encode("SLOT", scope, asOf, position, "-");
    }

    public SlotCursor decodeSlot(String cursor, String scope) {
        CursorState state = decode(cursor, "SLOT", scope);
        if (!"-".equals(state.identity())) throw invalid();
        return new SlotCursor(state.asOf(), state.position());
    }

    private String encode(
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
            scopeHash(scope),
            Long.toString(asOf.toEpochMilli()),
            Long.toString(position.toEpochMilli()),
            identity
        );
        byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
        return ENCODER.encodeToString(bytes) + "." +
            ENCODER.encodeToString(sign(bytes));
    }

    private CursorState decode(
        String cursor,
        String expectedKind,
        String scope
    ) {
        if (
            cursor == null ||
            cursor.isEmpty() ||
            cursor.length() > MAX_CURSOR_LENGTH ||
            !cursor.equals(cursor.trim()) ||
            cursor.chars().anyMatch(Character::isISOControl)
        ) {
            throw invalid();
        }
        String[] token = cursor.split("\\.", -1);
        if (token.length != 2 || token[0].isEmpty() || token[1].isEmpty()) {
            throw invalid();
        }
        byte[] payload;
        byte[] signature;
        try {
            payload = DECODER.decode(token[0]);
            signature = DECODER.decode(token[1]);
        } catch (IllegalArgumentException exception) {
            throw invalid();
        }
        if (
            payload.length == 0 ||
            payload.length > MAX_PAYLOAD_BYTES ||
            !MessageDigest.isEqual(sign(payload), signature)
        ) {
            throw invalid();
        }
        String decoded = new String(payload, StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(
            decoded.getBytes(StandardCharsets.UTF_8),
            payload
        )) {
            throw invalid();
        }
        String[] fields = decoded.split("\n", -1);
        if (
            fields.length != 6 ||
            !"1".equals(fields[0]) ||
            !expectedKind.equals(fields[1]) ||
            !constantEquals(scopeHash(scope), fields[2])
        ) {
            throw invalid();
        }
        try {
            long asOfMillis = Long.parseLong(fields[3]);
            long positionMillis = Long.parseLong(fields[4]);
            if (asOfMillis < 0 || positionMillis < 0) throw invalid();
            return new CursorState(
                Instant.ofEpochMilli(asOfMillis),
                Instant.ofEpochMilli(positionMillis),
                fields[5]
            );
        } catch (
            NumberFormatException |
            DateTimeException exception
        ) {
            throw invalid();
        }
    }

    private String scopeHash(String scope) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                scope.getBytes(StandardCharsets.UTF_8)
            );
            return ENCODER.encodeToString(digest);
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private byte[] sign(byte[] payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(payload);
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("HMAC-SHA256 is unavailable", exception);
        }
    }

    private boolean constantEquals(String left, String right) {
        return MessageDigest.isEqual(
            left.getBytes(StandardCharsets.US_ASCII),
            right.getBytes(StandardCharsets.US_ASCII)
        );
    }

    private BusinessException invalid() {
        return new BusinessException(
            "INTERVIEW_CURSOR_INVALID",
            "Pagination cursor is invalid for this query",
            HttpStatus.BAD_REQUEST
        );
    }

    public record PageCursor(
        Instant asOf,
        Instant position,
        UUID id
    ) {}

    public record SlotCursor(Instant asOf, Instant position) {}

    private record CursorState(
        Instant asOf,
        Instant position,
        String identity
    ) {}
}
