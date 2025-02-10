package model.Personas;

import java.util.ArrayList;

public class StaffDirectory {
    private ArrayList<StaffProfile> staffList; // List of staff profiles

    /**
     * Constructor to initialize the StaffDirectory.
     */
    public StaffDirectory() {
        this.staffList = new ArrayList<>();
    }

    /**
     * Adds a new StaffProfile to the directory.
     * @param staffProfile the StaffProfile to add
     */
    public void addStaffProfile(StaffProfile staffProfile) {
        staffList.add(staffProfile);
    }

    /**
     * Finds a StaffProfile by its associated Person's ID.
     * @param id the ID of the Person
     * @return the StaffProfile if found, otherwise null
     */
    public StaffProfile findStaff(String id) {
        for (StaffProfile staffProfile : staffList) {
            if (staffProfile.isMatch(id)) {
                return staffProfile;
            }
        }
        return null; // Not found
    }

    /**
     * Removes a StaffProfile from the directory by its associated Person's ID.
     * @param id the ID of the Person
     * @return true if the StaffProfile was removed, false if not found
     */
    public boolean removeStaff(String id) {
        StaffProfile staffProfile = findStaff(id);
        if (staffProfile != null) {
            staffList.remove(staffProfile);
            return true;
        }
        return false; // Not found
    }

    /**
     * Gets the list of all StaffProfiles in the directory.
     * @return the list of StaffProfiles
     */
    public ArrayList<StaffProfile> getStaffList() {
        return staffList;
    }
    // New method: Find Staff by Name
    public StaffProfile findStaffByName(String name) {
        for (StaffProfile staffProfile : staffList) {
            if (staffProfile.getPerson().getName().equalsIgnoreCase(name)) {
                return staffProfile;
            }
        }
        return null;
    }
    public StaffProfile findStaffByPersonID(String personID) {
        for (StaffProfile staff : staffList) {
            if (staff.getPerson().getId().equals(personID)) {
                return staff;
            }
        }
        return null;
    }
}
