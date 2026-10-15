package com.trustpass.worker;

import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/dev/mail")
@ConditionalOnProperty(name = "trustpass.mail.embedded", havingValue = "true", matchIfMissing = true)
@CrossOrigin(origins = "${trustpass.frontend-url:http://localhost:5173}")
class DevMailController {

    private final EmbeddedMailServer server;

    DevMailController(EmbeddedMailServer server) {
        this.server = server;
    }

    @GetMapping
    List<EmbeddedMailServer.Mail> inbox(@RequestParam(required = false) String to) {
        return server.inbox(to);
    }

    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void clear() throws Exception {
        server.clear();
    }
}
