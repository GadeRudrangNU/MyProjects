/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package model.Personas;

/**
 *
 * @author priyankbagad
 */

public class AnalystProfile extends Profile {
    /**
     * Constructor to initialize an AnalystProfile with a Person.
     * @param person the associated Person
     */
    public AnalystProfile(Person person) {
        super(person);
    }

    /**
     * Returns the role of the profile.
     * @return "Analyst"
     */
    @Override
    public String getRole() {
        return "Analyst";
    }
}

