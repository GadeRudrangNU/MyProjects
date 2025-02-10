package model.NotificationManagement;

public class Notification {
    private String id;         // Unique identifier for the notification
    private String title;      // Title of the notification
    private String message;    // Detailed message of the notification

    // Constructor
    public Notification(String id, String title, String message) {
        this.id = id;
        this.title = title;
        this.message = message;
    }

    // Getter and Setter methods
    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    @Override
    public String toString() {
        return "Notification{" +
                "id='" + id + '\'' +
                ", title='" + title + '\'' +
                ", message='" + message + '\'' +
                '}';
    }
}
