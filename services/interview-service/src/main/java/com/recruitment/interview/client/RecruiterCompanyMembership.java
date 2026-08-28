package com.recruitment.interview.client;

import java.util.UUID;

public record RecruiterCompanyMembership(
    UUID companyId,
    CompanyMemberRole memberRole
) {}
