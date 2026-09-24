CREATE SCHEMA IF NOT EXISTS admin;
CREATE TABLE admin.audit_log (
 id UUID PRIMARY KEY, operation_id UUID NOT NULL, admin_id UUID NOT NULL,
 action VARCHAR(60) NOT NULL, target_type VARCHAR(20) NOT NULL, target_id UUID NOT NULL,
 reason VARCHAR(1000), outcome VARCHAR(20) NOT NULL CHECK(outcome IN ('STARTED','SUCCEEDED','FAILED','UNKNOWN')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX audit_created_idx ON admin.audit_log(created_at DESC,id);
CREATE TABLE admin.reports (
 id UUID PRIMARY KEY, reporter_id UUID NOT NULL,
 target_type VARCHAR(20) NOT NULL CHECK(target_type IN ('JOB','COMPANY','USER')),
 target_id UUID NOT NULL, reason VARCHAR(1000) NOT NULL, description VARCHAR(5000),
 status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PROCESSING','RESOLVED','DISMISSED')),
 version INTEGER NOT NULL DEFAULT 0, handled_by UUID, handled_at TIMESTAMPTZ,
 resolution VARCHAR(1000), operation_id UUID,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX reports_status_idx ON admin.reports(status,created_at DESC,id);
CREATE TABLE admin.stat_events (
 event_id UUID PRIMARY KEY, topic VARCHAR(60) NOT NULL, entity_id UUID NOT NULL,
 metric VARCHAR(40), occurred_at TIMESTAMPTZ NOT NULL, payload_json JSONB NOT NULL
);
CREATE INDEX stat_date_idx ON admin.stat_events(occurred_at,metric,entity_id);
CREATE TABLE admin.daily_stats (
 stat_date DATE NOT NULL, metric VARCHAR(40) NOT NULL, value BIGINT NOT NULL CHECK(value>=0),
 PRIMARY KEY(stat_date,metric)
);
CREATE TABLE admin.dirty_stat_dates (stat_date DATE PRIMARY KEY);
CREATE TABLE admin.rejected_events (
 topic VARCHAR(60) NOT NULL, partition_id INTEGER NOT NULL, offset_id BIGINT NOT NULL,
 error_code VARCHAR(60) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(topic,partition_id,offset_id)
);
CREATE FUNCTION admin.reject_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit log is append only'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON admin.audit_log
FOR EACH ROW EXECUTE FUNCTION admin.reject_audit_change();

