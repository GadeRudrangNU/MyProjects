/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package model.Personas;

/**
 *
 * @author priyankbagad
 */

public class IssueManagerProfile extends Profile {
    /**
     * Constructor to initialize an IssueManagerProfile with a Person.
     * @param person the associated Person
     */
    public IssueManagerProfile(Person person) {
        super(person);
    }

    /**
     * Returns the role of the profile.
     * @return "Issue Manager"
     */
    @Override
    public String getRole() {
        return "IssueManager";
    }
}

