package com.trustpass.api.shared;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

public final class RequestContext {

    private RequestContext() {
    }

    public static String ip() {
        HttpServletRequest request = current();
        return request == null ? "system" : request.getRemoteAddr();
    }

    public static String userAgent() {
        HttpServletRequest request = current();
        String agent = request == null ? null : request.getHeader("User-Agent");
        if (agent == null) {
            return "unknown";
        }
        return agent.length() > 400 ? agent.substring(0, 400) : agent;
    }

    private static HttpServletRequest current() {
        return RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs
                ? attrs.getRequest() : null;
    }
}
