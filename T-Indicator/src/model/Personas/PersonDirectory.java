package model.Personas;

import java.util.ArrayList;
import model.UserManagement.User;

public class PersonDirectory {
    private ArrayList<Person> personList;

    // Constructor
    public PersonDirectory() {
        this.personList = new ArrayList<>();
        createPrepopulatedUser();
        
    }

    private void createPrepopulatedUser() {
        User prepopulatedUser = new User("demoUser123", "password123", "Staff");
        Person prepopulatedPerson = new Person("1", "John", "Doe", "john.doe@example.com");
        prepopulatedPerson.setUser(prepopulatedUser);
        personList.add(prepopulatedPerson);

        // Log the prepopulated user
       
    }
    /**
     * Adds a new Person to the directory.
     * @param person the Person to add
     */
   public void addPerson(Person person) {
        personList.add(person);
        // Profiles can be managed as needed, possibly stored within Person or separately
    }
   
//   public void addStaff(Person person) {
//        Profile staffProfile = new StaffProfile(person);
//        addPerson(person, staffProfile);
//    }

    /**
     * Adds a new Technician to the directory.
     * @param person the Person to add
     */
//    public void addTechnician(Person person) {
//        Profile technicianProfile = new TechnicianProfile(person);
//        addPerson(person, technicianProfile);
//    }

    /**
     * Adds a new User to the directory.
     * @param person the Person to add
     */
    

    /**
     * Finds a Person by their ID.
     * @param id the ID of the Person to find
     * @return the Person if found, otherwise null
     */
    public Person findPersonById(String id) {
        for (Person person : personList) {
            if (person.getId().equals(id)) {
                return person;
            }
        }
        return null; // Not found
    }
    public Person findPersonByUser(User user) {
    for (Person person : personList) { // Assuming personList is your list of Person objects
        if (person.getUser() != null && person.getUser().equals(user)) {
            return person;
        }
    }
    return null; // No match found
}

    public Person findPersonByName(String firstName, String lastName) {
    for (Person person : personList) {
        if (person.getFirstName().equals(firstName) && person.getLastName().equals(lastName)) {
            return person;
        }
    }
    return null; // No person found with that name
}

    /**
     * Finds a Person by their email.
     * @param email the email of the Person to find
     * @return the Person if found, otherwise null
     */
    public Person findPersonByEmail(String email) {
        for (Person person : personList) {
            if (person.getEmail().equals(email)) {
                return person;
            }
        }
        return null; // Not found
    }

    /**
     * Gets the list of all Persons in the directory.
     * @return the list of Persons
     */
    public ArrayList<Person> getPersonList() {
        return personList;
    }

    /**
     * Removes a Person from the directory by ID.
     * @param id the ID of the Person to remove
     * @return true if the Person was removed, false if not found
     */
    public boolean removePersonById(String id) {
        Person person = findPersonById(id);
        if (person != null) {
            personList.remove(person);
            return true;
        }
        return false; // Not found
    }
    /**
     * Searches for a Person by name, email, or ID.
     * @param searchInput the search input
     * @return the matching Person if found, otherwise null
     */
    public Person searchPerson(String searchInput) {
        for (Person person : personList) {
            if (person.getId().equalsIgnoreCase(searchInput) ||
                person.getFirstName().equalsIgnoreCase(searchInput) ||
                person.getLastName().equalsIgnoreCase(searchInput) ||
                person.getEmail().equalsIgnoreCase(searchInput)) {
                return person;
            }
        }
        return null;
    }
}
