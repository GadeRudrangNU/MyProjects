/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package model.Personas;

/**
 *
 * @author priyankbagad
 */
public class CustomerServiceRepresentativeProfile extends Profile {
    /**
     * Constructor to initialize a CustomerServiceRepresentativeProfile with a Person.
     * @param person the associated Person
     */
    public CustomerServiceRepresentativeProfile(Person person) {
        super(person);
    }

    /**
     * Returns the role of the profile.
     * @return "Customer Service Representative"
     */
    @Override
    public String getRole() {
        return "CustomerServiceRepresentative";
    }
}

