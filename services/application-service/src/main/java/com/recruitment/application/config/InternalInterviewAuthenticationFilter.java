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
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;

public class InternalInterviewAuthenticationFilter
    extends OncePerRequestFilter {
    private static final String INTERVIEW_SERVICE = "interview-service";
    private static final String KEY_HEADER = "X-Internal-Api-Key";
    private static final String SERVICE_HEADER = "X-Internal-Service";
    private static final byte[] DUMMY_KEY = new byte[32];

    private final byte[] expectedKey;
    private final JwtDecoder jwtDecoder;

    public InternalInterviewAuthenticationFilter(
        String configuredKey,
        JwtDecoder jwtDecoder
    ) {
        String key = configuredKey == null ? "" : configuredKey;
        byte[] bytes = key.getBytes(StandardCharsets.UTF_8);
        if (
            bytes.length < 32 ||
            !key.equals(key.trim()) ||
            key.toLowerCase(Locale.ROOT).contains("replace-with") ||
            key.chars().anyMatch(Character::isISOControl)
        ) {
            throw new IllegalStateException(
                "INTERNAL_API_KEY_INTERVIEW must be a non-placeholder key " +
                "of at least 32 bytes"
            );
        }
        this.expectedKey = bytes;
        this.jwtDecoder = jwtDecoder;
    }

    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain filterChain
    ) throws ServletException, IOException {
        String service = singleHeader(request, SERVICE_HEADER);
        String key = singleHeader(request, KEY_HEADER);
        String authorization = singleHeader(
            request,
            HttpHeaders.AUTHORIZATION
        );
        String token = bearerToken(authorization);

        if (
            !INTERVIEW_SERVICE.equals(service) ||
            !matches(key) ||
            token == null
        ) {
            unauthorized(response);
            return;
        }

        Jwt jwt;
        String subject;
        try {
            jwt = jwtDecoder.decode(token);
            subject = canonicalUuid(jwt.getSubject());
            if (
                subject == null ||
                !(jwt.getClaim("role") instanceof String role) ||
                !"RECRUITER".equals(role)
            ) {
                unauthorized(response);
                return;
            }
        } catch (JwtException | IllegalArgumentException exception) {
            SecurityContextHolder.clearContext();
            unauthorized(response);
            return;
        }

        JwtAuthenticationToken authentication = new JwtAuthenticationToken(
            jwt,
            List.of(
                new SimpleGrantedAuthority("ROLE_INTERNAL_INTERVIEW"),
                new SimpleGrantedAuthority("ROLE_RECRUITER")
            ),
            subject
        );
        SecurityContextHolder.getContext().setAuthentication(authentication);
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

    private String bearerToken(String authorization) {
        if (
            authorization == null ||
            !authorization.startsWith("Bearer ")
        ) return null;
        String token = authorization.substring(7);
        if (
            token.isBlank() ||
            token.chars().anyMatch(Character::isWhitespace)
        ) return null;
        return token;
    }

    private String canonicalUuid(String value) {
        if (value == null) return null;
        UUID uuid = UUID.fromString(value);
        return uuid.toString().equals(value) ? value : null;
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
