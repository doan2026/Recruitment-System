package com.recruitment.auth.controller;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import com.recruitment.auth.exception.AuthBusinessException;
import com.recruitment.auth.exception.GlobalExceptionHandler;
import com.recruitment.auth.security.filter.LoginCacheControlFilter;
import com.recruitment.auth.service.login.LoginService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class LoginControllerTest {
  private LoginService login;
  private MockMvc mvc;

  @BeforeEach
  void setUp() {
    login = org.mockito.Mockito.mock(LoginService.class);
    mvc = MockMvcBuilders.standaloneSetup(new LoginController(login))
        .setControllerAdvice(new GlobalExceptionHandler())
        .addFilters(new LoginCacheControlFilter())
        .build();
  }

  @Test
  void successHasNoStoreHeadersAndNeverEchoesPassword() throws Exception {
    when(login.login(any())).thenReturn(null);

    mvc.perform(post("/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"email":"candidate@example.com","password":"candidate1"}
                """))
        .andExpect(status().isOk())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store, no-cache"))
        .andExpect(header().string(HttpHeaders.PRAGMA, "no-cache"))
        .andExpect(header().string(HttpHeaders.EXPIRES, "0"))
        .andExpect(content().string(not(containsString("candidate1"))));
  }

  @Test
  void authenticationErrorsAlsoHaveNoStoreHeaders() throws Exception {
    when(login.login(any())).thenThrow(new AuthBusinessException(
        "INVALID_CREDENTIALS",
        "Email or password is incorrect",
        HttpStatus.UNAUTHORIZED));

    mvc.perform(post("/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"email":"candidate@example.com","password":"candidate1"}
                """))
        .andExpect(status().isUnauthorized())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store, no-cache"))
        .andExpect(header().string(HttpHeaders.PRAGMA, "no-cache"))
        .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"))
        .andExpect(content().string(not(containsString("candidate1"))));
  }

  @Test
  void malformedRequestIsRejectedBeforeServiceAndIsNotCacheable() throws Exception {
    mvc.perform(post("/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"email":"not-an-email","password":""}
                """))
        .andExpect(status().isBadRequest())
        .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store, no-cache"))
        .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

    verify(login, never()).login(any());
  }
}
