CREATE INDEX applications_company_applied_idx
    ON applications(company_id, applied_at);

CREATE INDEX application_history_application_status_idx
    ON application_history(application_id, to_status);
