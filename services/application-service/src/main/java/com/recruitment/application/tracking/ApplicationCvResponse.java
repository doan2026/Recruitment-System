package com.recruitment.application.tracking;

import com.recruitment.application.client.ProfileClient.ProfileCv;
import java.time.Instant;
import java.util.UUID;

public record ApplicationCvResponse(
    UUID cvId,
    String title,
    String type,
    boolean isDeleted,
    Instant createdAt
) {
    static ApplicationCvResponse from(ProfileCv cv) {
        return new ApplicationCvResponse(
            cv.cvId(),
            cv.title(),
            cv.type(),
            cv.isDeleted(),
            cv.createdAt()
        );
    }
}
