package com.recruitment.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthComponent;
import org.springframework.boot.actuate.health.HealthEndpoint;
import org.springframework.boot.actuate.health.Status;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

class HealthControllerTest {
  @Test
  void returnsServiceUnavailableWhenAggregateHealthIsDown() {
    HealthEndpoint endpoint = mock(HealthEndpoint.class);
    when(endpoint.health()).thenReturn(Health.down().build());

    ResponseEntity<HealthComponent> response =
        new HealthController(endpoint).health();

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    assertThat(response.getBody().getStatus()).isEqualTo(Status.DOWN);
  }

  @Test
  void returnsOkWhenAggregateHealthIsUp() {
    HealthEndpoint endpoint = mock(HealthEndpoint.class);
    when(endpoint.health()).thenReturn(Health.up().build());

    ResponseEntity<HealthComponent> response =
        new HealthController(endpoint).health();

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody().getStatus()).isEqualTo(Status.UP);
  }
}
