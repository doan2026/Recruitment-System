package com.recruitment.application.tracking;

import com.recruitment.application.client.ProfileClient.CvDownloadUrl;
import java.time.Instant;
import java.util.UUID;

public record ApplicationCvDownloadResponse(
    UUID cvId,
    String url,
    Instant expiresAt
) {
    static ApplicationCvDownloadResponse from(CvDownloadUrl download) {
        return new ApplicationCvDownloadResponse(
            download.cvId(),
            download.url(),
            download.expiresAt()
        );
    }
}
