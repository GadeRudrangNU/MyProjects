/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package model.Personas;

/**
 *
 * @author priyankbagad
 */
public class LineManagerProfile extends Profile {
    /**
     * Constructor to initialize a LineManagerProfile with a Person.
     * @param person the associated Person
     */
    public LineManagerProfile(Person person) {
        super(person);
    }

    /**
     * Returns the role of the profile.
     * @return "Line Manager"
     */
    @Override
    public String getRole() {
        return "LineManager";
    }
}

