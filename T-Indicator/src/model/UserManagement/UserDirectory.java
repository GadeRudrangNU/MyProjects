package model.UserManagement;

import java.util.ArrayList;
import model.Personas.Person;
import model.Personas.PersonDirectory;

public class UserDirectory {
    private ArrayList<User> userList; // List to store User objects
    private PersonDirectory personDirectory;

    /**
     * Constructor to initialize the UserDirectory.
     */
    public UserDirectory(PersonDirectory personDirectory) {
        this.personDirectory = personDirectory;
        userList = new ArrayList<>();
    }

    /**
     * Adds a User to the directory.
     * @param user the User object to add
     */
    public void addUser(User user) {
        userList.add(user);
    }

    /**
     * Authenticates a user by username and password.
     * @param username the username to authenticate
     * @param password the password to authenticate
     * @return the authenticated User object, or null if authentication fails
     */
    public User authenticateUser(String username, String password) {
        /*for (User user : userList) {
            if (user.getUsername().equals(username) && user.getPassword().equals(password)) {
                return user; // Authentication successful
            }
        }
        return null; // Authentication failed*/
        for (Person person : personDirectory.getPersonList()) {
            User user = person.getUser();  // Get the User object from Person
            if (user != null && user.getUsername().equals(username) && user.getPassword().equals(password)) {
                return user;  // Authentication successful
            }
        }
        return null; // Authentication failed
    }

    /**
     * Finds a User in the directory by username.
     * @param username the username to search for
     * @return the User object if found, otherwise null
     */
    public User findUserByUsername(String username) {
        for (User user : userList) {
            if (user.getUsername().equals(username)) {
                return user;
            }
        }
        return null; // User not found
    }

    /**
     * Gets the list of all Users in the directory.
     * @return the list of Users
     */
    public ArrayList<User> getUserList() {
        return userList;
    }
}
