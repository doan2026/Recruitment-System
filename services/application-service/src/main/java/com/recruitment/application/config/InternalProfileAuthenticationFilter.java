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

public class InternalProfileAuthenticationFilter
    extends OncePerRequestFilter {
    private static final String PROFILE_SERVICE = "profile-service";
    private static final String KEY_HEADER = "X-Internal-Api-Key";
    private static final String SERVICE_HEADER = "X-Internal-Service";
    private static final byte[] DUMMY_KEY = new byte[32];

    private final byte[] expectedKey;

    public InternalProfileAuthenticationFilter(String configuredKey) {
        String key = configuredKey == null ? "" : configuredKey;
        byte[] bytes = key.getBytes(StandardCharsets.UTF_8);
        if (
            bytes.length < 32 ||
            !key.equals(key.trim()) ||
            key.toLowerCase(Locale.ROOT).contains("replace-with") ||
            key.chars().anyMatch(character -> Character.isISOControl(character))
        ) {
            throw new IllegalStateException(
                "INTERNAL_API_KEY_PROFILE must be a non-placeholder key " +
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
        String service = singleHeader(request, SERVICE_HEADER);
        String key = singleHeader(request, KEY_HEADER);
        if (
            !PROFILE_SERVICE.equals(service) ||
            !matches(key)
        ) {
            unauthorized(response);
            return;
        }

        UsernamePasswordAuthenticationToken authentication =
            UsernamePasswordAuthenticationToken.authenticated(
                PROFILE_SERVICE,
                null,
                List.of(new SimpleGrantedAuthority("ROLE_INTERNAL_PROFILE"))
            );
        SecurityContextHolder.getContext().setAuthentication(authentication);
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        filterChain.doFilter(request, response);
    }

    private String singleHeader(
        HttpServletRequest request,
        String name
    ) {
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

    private void unauthorized(HttpServletResponse response)
        throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        response.getWriter().write(
            "{\"code\":\"INTERNAL_AUTH_INVALID\"," +
            "\"message\":\"Internal service authentication failed\"," +
            "\"details\":null}"
        );
    }
}
