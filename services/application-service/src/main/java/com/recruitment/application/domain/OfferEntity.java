package com.recruitment.application.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(
    name = "offers",
    uniqueConstraints = @UniqueConstraint(
        name = "offers_application_unique",
        columnNames = "application_id"
    )
)
public class OfferEntity {
    @Id
    private UUID id;

    @Column(name = "application_id", nullable = false)
    private UUID applicationId;

    @Column(name = "sent_by", nullable = false)
    private UUID sentBy;

    @Column(nullable = false, precision = 19, scale = 2)
    private BigDecimal salary;

    @Column(name = "start_date", nullable = false)
    private LocalDate startDate;

    @Column(nullable = false, length = 200)
    private String position;

    @Column(length = 2000)
    private String note;

    @Column(name = "file_id")
    private UUID fileId;

    @Column(name = "file_url", length = 2048)
    private String fileUrl;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private OfferStatus status;

    @Column(name = "sent_at", nullable = false)
    private Instant sentAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "responded_at")
    private Instant respondedAt;

    @Column(name = "response_note", length = 2000)
    private String responseNote;

    @Version
    @Column(nullable = false)
    private long version;

    protected OfferEntity() {}

    public static OfferEntity sent(
        UUID id,
        UUID applicationId,
        UUID sentBy,
        BigDecimal salary,
        LocalDate startDate,
        String position,
        String note,
        UUID fileId,
        String fileUrl,
        Instant sentAt,
        Instant expiresAt
    ) {
        OfferEntity offer = new OfferEntity();
        offer.id = id;
        offer.applicationId = applicationId;
        offer.sentBy = sentBy;
        offer.salary = salary;
        offer.startDate = startDate;
        offer.position = position;
        offer.note = note;
        offer.fileId = fileId;
        offer.fileUrl = fileUrl;
        offer.status = OfferStatus.SENT;
        offer.sentAt = sentAt;
        offer.expiresAt = expiresAt;
        return offer;
    }

    public UUID getId() {
        return id;
    }

    public UUID getApplicationId() {
        return applicationId;
    }

    public UUID getSentBy() {
        return sentBy;
    }

    public BigDecimal getSalary() {
        return salary;
    }

    public LocalDate getStartDate() {
        return startDate;
    }

    public String getPosition() {
        return position;
    }

    public String getNote() {
        return note;
    }

    public UUID getFileId() {
        return fileId;
    }

    public String getFileUrl() {
        return fileUrl;
    }

    public OfferStatus getStatus() {
        return status;
    }

    public Instant getSentAt() {
        return sentAt;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getRespondedAt() {
        return respondedAt;
    }

    public String getResponseNote() {
        return responseNote;
    }

    public long getVersion() {
        return version;
    }
}
