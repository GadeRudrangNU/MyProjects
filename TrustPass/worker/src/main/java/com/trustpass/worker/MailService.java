package com.trustpass.worker;

import jakarta.mail.internet.MimeMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

@Service
public class MailService {

    private final JavaMailSender sender;
    private final WorkerProperties props;

    MailService(JavaMailSender sender, WorkerProperties props) {
        this.sender = sender;
        this.props = props;
    }

    public void send(String to, String subject, String body) throws Exception {
        MimeMessage message = sender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message, "UTF-8");
        helper.setFrom(props.mail().from());
        helper.setTo(to);
        helper.setSubject(subject);
        helper.setText(body, false);
        sender.send(message);
    }
}
