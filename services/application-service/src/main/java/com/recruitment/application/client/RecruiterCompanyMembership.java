package com.recruitment.application.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.UUID;

@JsonIgnoreProperties(ignoreUnknown = true)
public record RecruiterCompanyMembership(
    UUID companyId,
    CompanyMemberRole memberRole
) {
    public boolean canManageAllCompanyApplications() {
        return memberRole == CompanyMemberRole.MEMBER ||
            memberRole == CompanyMemberRole.OWNER;
    }
}
