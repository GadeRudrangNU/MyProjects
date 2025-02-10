package model.Personas;

public class TechnicianProfile extends Profile {

    /**
     * Constructor to initialize a TechnicianProfile with a Person.
     * @param person the associated Person
     */
    public TechnicianProfile(Person person) {
        super(person);
    }

    /**
     * Returns the role of the profile.
     * @return "Technician"
     */
    @Override
    public String getRole() {
        return "Technician";
    }
}
