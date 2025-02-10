package model.Personas;

import java.util.ArrayList;

public class LineManagerDirectory {
    private ArrayList<LineManagerProfile> lineManagerList; // List of line manager profiles

    /**
     * Constructor to initialize the LineManagerDirectory.
     */
    public LineManagerDirectory() {
        this.lineManagerList = new ArrayList<>();
    }

    /**
     * Adds a new LineManagerProfile to the directory.
     * @param lineManagerProfile the LineManagerProfile to add
     */
    public void addLineManagerProfile(LineManagerProfile lineManagerProfile) {
        lineManagerList.add(lineManagerProfile);
    }

    /**
     * Finds a LineManagerProfile by its associated Person's ID.
     * @param id the ID of the Person
     * @return the LineManagerProfile if found, otherwise null
     */
    public LineManagerProfile findLineManager(String id) {
        for (LineManagerProfile lineManagerProfile : lineManagerList) {
            if (lineManagerProfile.isMatch(id)) {
                return lineManagerProfile;
            }
        }
        return null; // Not found
    }

    /**
     * Removes a LineManagerProfile from the directory by its associated Person's ID.
     * @param id the ID of the Person
     * @return true if the LineManagerProfile was removed, false if not found
     */
    public boolean removeLineManager(String id) {
        LineManagerProfile lineManagerProfile = findLineManager(id);
        if (lineManagerProfile != null) {
            lineManagerList.remove(lineManagerProfile);
            return true;
        }
        return false; // Not found
    }

    /**
     * Finds a LineManagerProfile by Person ID.
     * @param personID the ID of the Person
     * @return the LineManagerProfile if found, otherwise null
     */
    public LineManagerProfile findLineManagerByPersonID(String personID) {
        for (LineManagerProfile profile : lineManagerList) {
            if (profile.getPerson().getId().equals(personID)) {
                return profile;
            }
        }
        return null; // Return null if no match found
    }

    /**
     * Gets the list of all LineManagerProfiles in the directory.
     * @return the list of LineManagerProfiles
     */
    public ArrayList<LineManagerProfile> getLineManagerList() {
        return lineManagerList;
    }
}
