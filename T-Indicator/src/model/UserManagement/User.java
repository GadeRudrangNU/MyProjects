package model.UserManagement;

/**
 * Represents a User with login credentials and role information.
 */
public class User {
    private String username; // The username for login
    private String password; // The password for login
    private String role;     // Role of the user, e.g., "Staff", "Admin"

    /**
     * Constructor to create a new User.
     * @param username the username of the user
     * @param password the password of the user
     * @param role the role of the user, e.g., "Staff" or "Admin"
     */
    public User(String username, String password, String role) {
        this.username = username;
        this.password = password;
        this.role = role;
    }

    // Getters and Setters

    /**
     * Gets the username of the user.
     * @return the username
     */
    public String getUsername() {
        return username;
    }

    /**
     * Sets the username of the user.
     * @param username the new username
     */
    public void setUsername(String username) {
        this.username = username;
    }

    /**
     * Gets the password of the user.
     * @return the password
     */
    public String getPassword() {
        return password;
    }

    /**
     * Sets the password of the user.
     * @param password the new password
     */
    public void setPassword(String password) {
        this.password = password;
    }

    /**
     * Gets the role of the user.
     * @return the role
     */
    public String getRole() {
        return role;
    }

    /**
     * Sets the role of the user.
     * @param role the new role
     */
    public void setRole(String role) {
        this.role = role;
    }
}
