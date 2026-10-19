# Monitoring Skill
Use Prometheus + Grafana, Loki, and optionally OpenTelemetry. Services expose /health/live, /health/ready, /metrics. Monitor request rate, latency, errors, CPU/RAM, goroutines, DB connections, Kafka lag, WebSocket/SSE connections, active calls, and SFU health. Use structured JSON logs with request_id/event_id. Never log secrets or tokens.
