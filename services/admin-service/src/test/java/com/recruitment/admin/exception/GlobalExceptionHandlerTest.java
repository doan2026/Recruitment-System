package com.recruitment.admin.exception;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

class GlobalExceptionHandlerTest {
  @Test
  void missingRequiredQueryIsClientValidationFailure() throws Exception {
    MockMvcBuilders.standaloneSetup(new RequiredQueryController())
        .setControllerAdvice(new GlobalExceptionHandler()).build()
        .perform(get("/query"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
  }

  @RestController
  static class RequiredQueryController {
    @GetMapping("/query")
    String get(@RequestParam("from") String from) { return from; }
  }
}
