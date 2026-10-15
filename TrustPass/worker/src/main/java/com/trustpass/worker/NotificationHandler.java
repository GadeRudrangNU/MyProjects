package com.trustpass.worker;

import com.trustpass.common.FieldCrypto;
import com.trustpass.common.JobType;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
class NotificationHandler implements JobHandler {

    private static final DateTimeFormatter WHEN =
            DateTimeFormatter.ofPattern("EEE d MMM yyyy, HH:mm 'UTC'", Locale.ENGLISH).withZone(ZoneOffset.UTC);

    private final MailService mail;
    private final FieldCrypto crypto;
    private final WorkerProperties props;

    NotificationHandler(MailService mail, FieldCrypto crypto, WorkerProperties props) {
        this.mail = mail;
        this.crypto = crypto;
        this.props = props;
    }

    @Override
    public Set<JobType> types() {
        return Set.of(JobType.EMAIL_VERIFICATION, JobType.VERIFICATION_DECIDED, JobType.PAYMENT_SUCCEEDED,
                JobType.PAYMENT_FAILED, JobType.BOOKING_CONFIRMED, JobType.BOOKING_CANCELLED,
                JobType.WAITLIST_PROMOTED, JobType.WAITLIST_JOINED);
    }

    @Override
    public void handle(Job job) throws Exception {
        String to = job.text("email");
        String name = job.text("name");
        if (to == null) {
            throw new IllegalArgumentException("job has no recipient");
        }
        String[] content = compose(job, name == null ? "there" : name);
        mail.send(to, content[0], content[1]);
    }

    private String[] compose(Job job, String name) {
        return switch (job.type()) {
            case EMAIL_VERIFICATION -> {
                String token = crypto.decrypt(job.text("token"));
                String link = props.frontendUrl() + "/verify-email?token=" + URLEncoder.encode(token, StandardCharsets.UTF_8);
                yield new String[]{"Verify your TrustPass email",
                        "Hi " + name + ",\n\nConfirm your email address to finish creating your account:\n\n" + link
                                + "\n\nThe link expires in 24 hours. If you did not sign up, you can ignore this message.\n"};
            }
            case VERIFICATION_DECIDED -> "VERIFIED".equals(job.text("decision"))
                    ? new String[]{"Your identity is verified",
                    "Hi " + name + ",\n\nYour identity verification was approved. You can now use TrustPass everywhere you sign in.\n"}
                    : new String[]{"Your identity verification needs attention",
                    "Hi " + name + ",\n\nWe could not approve your documents.\n\nReason: " + job.text("reason")
                            + "\n\nYou can submit new documents from your account.\n"};
            case PAYMENT_SUCCEEDED -> new String[]{"Payment received",
                    "Hi " + name + ",\n\nWe received " + money(job) + " for your " + job.text("plan")
                            + " membership. Thank you.\n"};
            case PAYMENT_FAILED -> new String[]{"Your payment did not go through",
                    "Hi " + name + ",\n\nThe " + money(job) + " payment for your " + job.text("plan")
                            + " membership failed (" + job.text("reason") + "). Nothing was kept, and you can try again any time.\n"};
            case BOOKING_CONFIRMED -> new String[]{"Booking confirmed",
                    "Hi " + name + ",\n\nYou are booked at " + job.text("location") + " on " + when(job) + ".\n"};
            case BOOKING_CANCELLED -> new String[]{"Booking cancelled",
                    "Hi " + name + ",\n\nYour booking at " + job.text("location") + " on " + when(job) + " was cancelled.\n"};
            case WAITLIST_PROMOTED -> new String[]{"A spot opened up for you",
                    "Hi " + name + ",\n\nGood news: a spot opened at " + job.text("location") + " on " + when(job)
                            + " and it is now yours. Your booking is confirmed.\n"};
            case WAITLIST_JOINED -> new String[]{"You are on the waitlist",
                    "Hi " + name + ",\n\nYou joined the waitlist for " + job.text("location") + " on " + when(job)
                            + ". We will email you if a spot opens.\n"};
            default -> throw new IllegalArgumentException("not a notification: " + job.type());
        };
    }

    private static String when(Job job) {
        return WHEN.format(Instant.parse(job.text("startsAt")));
    }

    private static String money(Job job) {
        long cents = Long.parseLong(job.text("amountCents"));
        return String.format(Locale.ENGLISH, "$%d.%02d", cents / 100, cents % 100);
    }
}
