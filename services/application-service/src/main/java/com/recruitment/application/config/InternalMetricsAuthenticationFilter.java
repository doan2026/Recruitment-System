package com.recruitment.application.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Guards the Prometheus scrape with its own scoped credential.
 *
 * <p>A scrape carries no user, so this checks a key rather than a token. The
 * key is deliberately distinct from the Profile and Interview credentials: a
 * service authorised to submit CVs has no business reading the request rates
 * and latency distribution of the whole deployment, and reusing one key would
 * silently grant exactly that.</p>
 */
public class InternalMetricsAuthenticationFilter extends OncePerRequestFilter {
    private static final String KEY_HEADER = "X-Internal-Api-Key";
    private static final byte[] DUMMY_KEY = new byte[32];

    private final byte[] expectedKey;

    public InternalMetricsAuthenticationFilter(String configuredKey) {
        String key = configuredKey == null ? "" : configuredKey;
        byte[] bytes = key.getBytes(StandardCharsets.UTF_8);
        if (
            bytes.length < 32 ||
            !key.equals(key.trim()) ||
            key.toLowerCase(Locale.ROOT).contains("replace-with") ||
            key.chars().anyMatch(Character::isISOControl)
        ) {
            throw new IllegalStateException(
                "INTERNAL_API_KEY_METRICS must be a non-placeholder key " +
                "of at least 32 bytes"
            );
        }
        this.expectedKey = bytes;
    }

    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain filterChain
    ) throws ServletException, IOException {
        if (!matches(singleHeader(request, KEY_HEADER))) {
            SecurityContextHolder.clearContext();
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
            response.setHeader(HttpHeaders.PRAGMA, "no-cache");
            response.getWriter().write(
                "{\"code\":\"INTERNAL_AUTH_INVALID\"," +
                "\"message\":\"Internal service authentication failed\"," +
                "\"details\":null}"
            );
            return;
        }

        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(
                "metrics-scrape",
                null,
                List.of(new SimpleGrantedAuthority("ROLE_INTERNAL_METRICS"))
            )
        );
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        filterChain.doFilter(request, response);
    }

    private String singleHeader(HttpServletRequest request, String name) {
        List<String> values = Collections.list(request.getHeaders(name));
        if (values.size() != 1) return null;
        String value = values.getFirst();
        if (value == null || value.isBlank() || value.contains(",")) {
            return null;
        }
        return value;
    }

    private boolean matches(String provided) {
        byte[] actual = provided == null
            ? DUMMY_KEY
            : provided.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(expectedKey, actual);
    }
}
