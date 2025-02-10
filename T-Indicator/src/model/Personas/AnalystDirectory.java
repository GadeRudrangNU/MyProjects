package model.Personas;

import java.util.ArrayList;

public class AnalystDirectory {
    private ArrayList<AnalystProfile> analystList; // List of analyst profiles

    /**
     * Constructor to initialize the AnalystDirectory.
     */
    public AnalystDirectory() {
        this.analystList = new ArrayList<>();
    }

    /**
     * Adds a new AnalystProfile to the directory.
     * @param analystProfile the AnalystProfile to add
     */
    public void addAnalystProfile(AnalystProfile analystProfile) {
        analystList.add(analystProfile);
    }

    /**
     * Finds an AnalystProfile by its associated Person's ID.
     * @param id the ID of the Person
     * @return the AnalystProfile if found, otherwise null
     */
    public AnalystProfile findAnalystByPersonID(String id) {
        for (AnalystProfile analystProfile : analystList) {
            if (analystProfile.isMatch(id)) {
                return analystProfile;
            }
        }
        return null; // Not found
    }

    /**
     * Removes an AnalystProfile from the directory by its associated Person's ID.
     * @param id the ID of the Person
     * @return true if the AnalystProfile was removed, false if not found
     */
    public boolean removeAnalyst(String id) {
        AnalystProfile analystProfile = findAnalystByPersonID(id);
        if (analystProfile != null) {
            analystList.remove(analystProfile);
            return true;
        }
        return false; // Not found
    }

    /**
     * Gets the list of all AnalystProfiles in the directory.
     * @return the list of AnalystProfiles
     */
    public ArrayList<AnalystProfile> getAnalystList() {
        return analystList;
    }
}
