package model.Personas;

public class AdminProfile extends Profile {

    /**
     * Constructor to initialize an AdminProfile with a Person.
     * @param person the associated Person
     */
    public AdminProfile(Person person) {
        super(person);
    }

    /**
     * Returns the role of the profile.
     * @return "Admin"
     */
    @Override
    public String getRole() {
        return "Admin";
    }
}
