package com.trustpass.api.authserver;

import io.swagger.v3.oas.annotations.Hidden;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.util.HtmlUtils;

@Hidden
@Controller
class SsoPagesController {

    private static final Map<String, String> SCOPES = new LinkedHashMap<>();

    static {
        SCOPES.put("openid", "Confirm that it is you");
        SCOPES.put("profile", "Your name");
        SCOPES.put("email", "Your email address");
        SCOPES.put("verified_age_over_21", "A yes or no answer: is this a verified person over 21? Your date of birth is never shared");
    }

    @GetMapping(value = "/sso/login", produces = MediaType.TEXT_HTML_VALUE)
    @ResponseBody
    String login(HttpServletRequest request, @RequestParam(required = false) String error) {
        CsrfToken csrf = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
        String notice = error == null ? "" : "<p class=\"error\" role=\"alert\">Those details were not accepted. Check your email, password and code.</p>";
        return page("Sign in to TrustPass", notice + """
                <form method="post" action="/sso/login">
                  <input type="hidden" name="%s" value="%s">
                  <label for="username">Email</label>
                  <input id="username" name="username" type="email" autocomplete="username" required>
                  <label for="password">Password</label>
                  <input id="password" name="password" type="password" autocomplete="current-password" required>
                  <label for="code">Authenticator code <span class="hint">(only if you turned on two-factor)</span></label>
                  <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code">
                  <button type="submit">Sign in</button>
                </form>
                """.formatted(csrf.getParameterName(), HtmlUtils.htmlEscape(csrf.getToken())));
    }

    @GetMapping(value = "/oauth2/consent", produces = MediaType.TEXT_HTML_VALUE)
    @ResponseBody
    String consent(HttpServletRequest request, @RequestParam("client_id") String clientId,
                   @RequestParam("scope") String scope, @RequestParam("state") String state) {
        CsrfToken csrf = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
        StringBuilder items = new StringBuilder();
        for (String requested : scope.split(" ")) {
            String description = SCOPES.get(requested);
            if (description != null) {
                items.append("<li><label><input type=\"checkbox\" name=\"scope\" value=\"")
                        .append(HtmlUtils.htmlEscape(requested)).append("\" checked> ")
                        .append(HtmlUtils.htmlEscape(description)).append("</label></li>");
            }
        }
        String hidden = """
                <input type="hidden" name="%s" value="%s">
                <input type="hidden" name="client_id" value="%s">
                <input type="hidden" name="state" value="%s">
                """.formatted(csrf.getParameterName(), HtmlUtils.htmlEscape(csrf.getToken()),
                HtmlUtils.htmlEscape(clientId), HtmlUtils.htmlEscape(state));
        return page("Allow access", """
                <p><strong>%s</strong> is asking to use your TrustPass identity. It will receive:</p>
                <form method="post" action="/oauth2/authorize">
                  %s
                  <ul>%s</ul>
                  <button type="submit">Allow</button>
                </form>
                <form method="post" action="/oauth2/authorize">
                  %s
                  <button type="submit" class="secondary">Cancel</button>
                </form>
                """.formatted(HtmlUtils.htmlEscape(clientId), hidden, items, hidden));
    }

    private static String page(String title, String body) {
        return """
                <!doctype html>
                <html lang="en">
                <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>%s</title>
                <style>
                  :root { color-scheme: light dark; }
                  body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f6fb; color: #16213a; }
                  main { background: #fff; width: min(92vw, 420px); padding: 2rem; border-radius: 12px; box-shadow: 0 8px 30px rgba(20,30,60,.12); }
                  h1 { font-size: 1.3rem; margin-top: 0; }
                  label { display: block; margin: 1rem 0 .3rem; font-weight: 600; }
                  .hint { font-weight: 400; color: #55607a; }
                  input[type=email], input[type=password], input[type=text] { width: 100%%; padding: .6rem; border: 1px solid #aab3c8; border-radius: 8px; box-sizing: border-box; font-size: 1rem; }
                  ul { padding-left: 0; list-style: none; }
                  li { margin: .6rem 0; }
                  button { margin-top: 1.2rem; padding: .65rem 1.2rem; border: 0; border-radius: 8px; background: #1f4fd8; color: #fff; font-size: 1rem; cursor: pointer; }
                  button.secondary { background: #e6e9f2; color: #16213a; margin-top: .6rem; }
                  .error { color: #a4161a; }
                  @media (prefers-color-scheme: dark) {
                    body { background: #10162a; color: #e8ecf8; }
                    main { background: #19213a; }
                    input[type=email], input[type=password], input[type=text] { background: #10162a; color: #e8ecf8; border-color: #3a4568; }
                    .hint { color: #9aa6c6; }
                    button.secondary { background: #2b3556; color: #e8ecf8; }
                    .error { color: #ff8a8f; }
                  }
                </style>
                </head>
                <body><main><h1>%s</h1>%s</main></body>
                </html>
                """.formatted(title, title, body);
    }
}
