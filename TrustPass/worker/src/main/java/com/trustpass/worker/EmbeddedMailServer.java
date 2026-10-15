package com.trustpass.worker;

import com.icegreen.greenmail.util.GreenMail;
import com.icegreen.greenmail.util.GreenMailUtil;
import com.icegreen.greenmail.util.ServerSetup;
import jakarta.annotation.PreDestroy;
import jakarta.mail.Address;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "trustpass.mail.embedded", havingValue = "true", matchIfMissing = true)
public class EmbeddedMailServer {

    public record Mail(String to, String from, String subject, String body, Instant sentAt) {
    }

    private final GreenMail greenMail;

    EmbeddedMailServer(WorkerProperties props) {
        this.greenMail = new GreenMail(new ServerSetup(props.mail().smtpPort(), "127.0.0.1", ServerSetup.PROTOCOL_SMTP));
        this.greenMail.start();
    }

    public List<Mail> inbox(String recipient) {
        List<Mail> out = new ArrayList<>();
        for (MimeMessage message : greenMail.getReceivedMessages()) {
            try {
                String to = Arrays.stream(message.getAllRecipients()).map(Address::toString).reduce((a, b) -> a + ", " + b).orElse("");
                if (recipient == null || recipient.isBlank() || to.equalsIgnoreCase(recipient.trim())) {
                    out.add(new Mail(to, message.getFrom()[0].toString(), message.getSubject(),
                            GreenMailUtil.getBody(message).trim(), message.getSentDate().toInstant()));
                }
            } catch (MessagingException e) {
                throw new IllegalStateException(e);
            }
        }
        out.sort(Comparator.comparing(Mail::sentAt).reversed());
        return out;
    }

    public void clear() throws Exception {
        greenMail.purgeEmailFromAllMailboxes();
    }

    @PreDestroy
    void stop() {
        greenMail.stop();
    }
}
