package model.Personas;

public abstract class Profile {
     Person person;

    /**
     * Constructor to initialize a Profile with a Person.
     * @param person the associated Person
     */
    public Profile(Person person) {
        this.person = person;
    }

    /**
     * Gets the associated Person.
     * @return the Person
     */
    public Person getPerson() {
        return person;
    }

    /**
     * Sets the associated Person.
     * @param person the new Person
     */
    public void setPerson(Person person) {
        this.person = person;
    }

    /**
     * Gets the role of the profile.
     * This method must be implemented by subclasses.
     * @return the role as a String
     */
    public abstract String getRole();

    /**
     * Checks if the profile matches a given ID.
     * @param id the ID to check
     * @return true if the IDs match, false otherwise
     */
    public boolean isMatch(String id) {
        return person.getId().equals(id);
    }
}
