package model.Personas;

import java.util.ArrayList;

public class TechnicianDirectory {
    private ArrayList<TechnicianProfile> technicianList; // List of technician profiles

    /**
     * Constructor to initialize the TechnicianDirectory.
     */
    public TechnicianDirectory() {
        this.technicianList = new ArrayList<>();
    }

    /**
     * Adds a new TechnicianProfile to the directory.
     * @param technicianProfile the TechnicianProfile to add
     */
    public void addTechnicianProfile(TechnicianProfile technicianProfile) {
        technicianList.add(technicianProfile);
    }

    /**
     * Finds a TechnicianProfile by its associated Person's ID.
     * @param id the ID of the Person
     * @return the TechnicianProfile if found, otherwise null
     */
    public TechnicianProfile findTechnician(String id) {
        for (TechnicianProfile technicianProfile : technicianList) {
            if (technicianProfile.isMatch(id)) {
                return technicianProfile;
            }
        }
        return null; // Not found
    }

    /**
     * Removes a TechnicianProfile from the directory by its associated Person's ID.
     * @param id the ID of the Person
     * @return true if the TechnicianProfile was removed, false if not found
     */
    public boolean removeTechnician(String id) {
        TechnicianProfile technicianProfile = findTechnician(id);
        if (technicianProfile != null) {
            technicianList.remove(technicianProfile);
            return true;
        }
        return false; // Not found
    }
    
    public TechnicianProfile findTechnicianByPersonID(String personID) {
    for (TechnicianProfile profile : technicianList) {
        if (profile.getPerson().getId().equals(personID)) {
            return profile;
        }
    }
    return null; // Return null if no match found
}


    /**
     * Gets the list of all TechnicianProfiles in the directory.
     * @return the list of TechnicianProfiles
     */
    public ArrayList<TechnicianProfile> getTechnicianList() {
        return technicianList;
    }

    public String findTechnicianByPersonID(TechnicianProfile technicianID) {
        throw new UnsupportedOperationException("Not supported yet."); // Generated from nbfs://nbhost/SystemFileSystem/Templates/Classes/Code/GeneratedMethodBody
    }
}
