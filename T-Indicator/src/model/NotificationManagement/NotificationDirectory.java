package model.NotificationManagement;

import java.util.ArrayList;

public class NotificationDirectory {
    private ArrayList<Notification> notifications; // List to store notifications

    // Constructor
    public NotificationDirectory() {
        this.notifications = new ArrayList<>();
    }

    /**
     * Adds a new notification to the directory.
     * @param notification The notification to be added.
     */
    public void addNotification(Notification notification) {
        notifications.add(notification);
    }

    /**
     * Creates and adds a new notification to the directory.
     * @param id The unique identifier for the notification.
     * @param title The title of the notification.
     * @param message The detailed message of the notification.
     */
    public void addNotification(String id, String title, String message) {
        Notification notification = new Notification(id, title, message);
        notifications.add(notification);
    }

    /**
     * Deletes a notification by its ID.
     * @param id The ID of the notification to be deleted.
     * @return true if the notification was successfully deleted, false otherwise.
     */
    public boolean deleteNotification(String id) {
        for (Notification notification : notifications) {
            if (notification.getId().equals(id)) {
                notifications.remove(notification);
                return true;
            }
        }
        return false;
    }

    /**
     * Retrieves all notifications in the directory.
     * @return The list of notifications.
     */
    public ArrayList<Notification> getNotifications() {
        return notifications;
    }

    /**
     * Finds a notification by its ID.
     * @param id The ID of the notification to be found.
     * @return The notification if found, or null otherwise.
     */
    public Notification findNotificationById(String id) {
        for (Notification notification : notifications) {
            if (notification.getId().equals(id)) {
                return notification;
            }
        }
        return null;
    }
}
