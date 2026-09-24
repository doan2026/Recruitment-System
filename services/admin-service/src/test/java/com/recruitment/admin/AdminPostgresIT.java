package com.recruitment.admin;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import java.util.*;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;

@Testcontainers
class AdminPostgresIT {

  @Container
  static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>(
    "postgres:16-alpine"
  );

  static JdbcTemplate db;
  static TransactionTemplate tx;

  @BeforeAll
  static void setup() {
    var source = new DriverManagerDataSource(
      postgres.getJdbcUrl(),
      postgres.getUsername(),
      postgres.getPassword()
    );
    Flyway.configure()
      .dataSource(source)
      .schemas("admin")
      .defaultSchema("admin")
      .load()
      .migrate();
    db = new JdbcTemplate(source);
    tx = new TransactionTemplate(new DataSourceTransactionManager(source));
  }

  @BeforeEach
  void clean() {
    db.execute(
      "TRUNCATE admin.stat_events,admin.daily_stats,admin.dirty_stat_dates,admin.reports,admin.rejected_events"
    );
  }

  ConsumerRecord<String, String> record(
    UUID event,
    UUID entity,
    String day,
    String stage
  ) {
    return new ConsumerRecord<>(
      "application-events",
      0,
      0,
      entity.toString(),
      "{\"event_id\":\"" +
      event +
      "\",\"schema_version\":1,\"aggregate_version\":1,\"occurred_at\":\"" +
      day +
      "T01:00:00Z\",\"action\":\"STATUS_CHANGED\",\"application_id\":\"" +
      entity +
      "\",\"to_status\":\"" +
      stage +
      "\"}"
    );
  }

  @Test
  void replayAndLateDeliveryDoNotInflateDailyCounts() {
    var service = new StatisticsService(db, new ObjectMapper());
    UUID entity = UUID.randomUUID();
    var r = record(UUID.randomUUID(), entity, "2020-01-02", "APPLIED");
    tx.executeWithoutResult(s -> {
      service.consume(r);
      service.consume(r);
    });
    tx.executeWithoutResult(s -> service.aggregate());
    assertEquals(
      1,
      db.queryForObject("SELECT count(*) FROM admin.stat_events", Integer.class)
    );
    tx.executeWithoutResult(s ->
      service.consume(
        record(UUID.randomUUID(), entity, "2020-01-01", "APPLIED")
      )
    );
    tx.executeWithoutResult(s -> service.aggregate());
    assertEquals(
      0,
      service
        .daily(LocalDate.parse("2020-01-02"), LocalDate.parse("2020-01-02"))
        .size()
    );
    assertEquals(
      1L,
      service
        .daily(LocalDate.parse("2020-01-01"), LocalDate.parse("2020-01-01"))
        .getFirst()
        .get("value")
    );
  }

  @Test
  void malformedEventIsQuarantinedExactlyOnce() {
    var service = new StatisticsService(db, new ObjectMapper());
    var r = new ConsumerRecord<String, String>(
      "job-events",
      0,
      25,
      null,
      "invalid"
    );
    tx.executeWithoutResult(s -> {
      service.consume(r);
      service.consume(r);
    });
    assertEquals(
      1,
      db.queryForObject(
        "SELECT count(*) FROM admin.rejected_events",
        Integer.class
      )
    );
  }

  @Test
  void reportClaimUsesCompareAndSetAndAuditCannotBeChanged() {
    var store = new ModerationStore(db);
    UUID actor = UUID.randomUUID(), target = UUID.randomUUID(), op =
      UUID.randomUUID();
    UUID id = (UUID) tx
      .execute(s ->
        store.createReport(actor, "USER", target, "Policy violation", null)
      )
      .get("id");
    tx.executeWithoutResult(s -> store.claim(id, 0, actor, "Confirmed spam", op)
    );
    assertThrows(AdminFailure.class, () ->
      tx.execute(s -> store.claim(id, 0, actor, "duplicate", UUID.randomUUID()))
    );
    tx.executeWithoutResult(s -> store.finish(id, op, "RESOLVED"));
    assertEquals(
      "RESOLVED",
      db.queryForObject(
        "SELECT status FROM admin.reports WHERE id=?",
        String.class,
        id
      )
    );
    store.audit(op, actor, "LOCK_USER", "AUTH", target, "Spam", "STARTED");
    assertThrows(org.springframework.dao.DataAccessException.class, () ->
      db.update("DELETE FROM admin.audit_log WHERE operation_id=?", op)
    );
  }

  @Test
  void serviceStartsWithMigrationsAndExposesDocumentedSecuredApi()
    throws Exception {
    try (
      var context =
        new org.springframework.boot.builder.SpringApplicationBuilder(
          AdminServiceApplication.class
        ).run(
          "--server.port=0",
          "--spring.datasource.url=" + postgres.getJdbcUrl(),
          "--spring.datasource.username=" + postgres.getUsername(),
          "--spring.datasource.password=" + postgres.getPassword(),
          "--spring.kafka.listener.auto-startup=false",
          "--admin.jwt.issuer=https://auth.example.test",
          "--admin.jwt.audience=recruitment-api",
          "--springdoc.api-docs.enabled=true",
          "--springdoc.swagger-ui.enabled=true"
        )
    ) {
      int port =
        ((org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext) context).getWebServer()
          .getPort();
      var client = java.net.http.HttpClient.newHttpClient();
      var docs = client.send(
        java.net.http.HttpRequest.newBuilder(
          java.net.URI.create("http://localhost:" + port + "/v3/api-docs")
        ).build(),
        java.net.http.HttpResponse.BodyHandlers.ofString()
      );
      assertEquals(200, docs.statusCode());
      assertTrue(docs.body().contains("/stats/export"));
      assertTrue(docs.body().contains("/reports/{id}"));
      var protectedRoute = client.send(
        java.net.http.HttpRequest.newBuilder(
          java.net.URI.create("http://localhost:" + port + "/users")
        ).build(),
        java.net.http.HttpResponse.BodyHandlers.ofString()
      );
      assertEquals(401, protectedRoute.statusCode());
      assertTrue(
        protectedRoute
          .headers()
          .firstValue("Cache-Control")
          .orElse("")
          .contains("no-store")
      );
    }
  }
}
