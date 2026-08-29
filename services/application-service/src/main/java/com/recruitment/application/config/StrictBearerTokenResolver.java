package com.recruitment.application.config;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Collections;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.http.HttpHeaders;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.server.resource.BearerTokenErrors;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;

/**
 * Resolves only the canonical access-token transport used by Auth Service.
 */
public final class StrictBearerTokenResolver implements BearerTokenResolver {
    static final int MAX_TOKEN_BYTES = 8 * 1024;

    private static final Pattern AUTHORIZATION_PATTERN = Pattern.compile(
        "(?i:Bearer) ([A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+)"
    );

    @Override
    public String resolve(HttpServletRequest request) {
        List<String> values = Collections.list(
            request.getHeaders(HttpHeaders.AUTHORIZATION)
        );
        if (values.isEmpty()) {
            return null;
        }
        if (values.size() != 1) {
            throw malformed();
        }

        String authorization = values.getFirst();
        if (authorization == null) {
            throw malformed();
        }
        Matcher matcher = AUTHORIZATION_PATTERN.matcher(authorization);
        if (!matcher.matches()) {
            throw malformed();
        }

        String token = matcher.group(1);
        if (token.length() > MAX_TOKEN_BYTES) {
            throw malformed();
        }
        return token;
    }

    private OAuth2AuthenticationException malformed() {
        return new OAuth2AuthenticationException(
            BearerTokenErrors.invalidToken(
                "Bearer access token does not use the canonical format"
            )
        );
    }
}
