package model.Personas;

public class StaffProfile extends Profile {

    /**
     * Constructor to initialize a StaffProfile with a Person.
     * @param person the associated Person
     */
    public StaffProfile(Person person) {
        super(person);
    }

    /**
     * Returns the role of the profile.
     * @return "Staff"
     */
    @Override
    public String getRole() {
        return "Staff";
    }
    @Override
public boolean equals(Object obj) {
    if (this == obj) return true;
    if (obj == null || getClass() != obj.getClass()) return false;
    StaffProfile other = (StaffProfile) obj;
    return this.person.getId().equals(other.person.getId()); // Assumes person has a unique ID
}
}
