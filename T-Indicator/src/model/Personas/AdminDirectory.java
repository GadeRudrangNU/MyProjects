package model.Personas;

import java.util.ArrayList;

public class AdminDirectory {
    private ArrayList<AdminProfile> adminList; // List of admin profiles

    /**
     * Constructor to initialize the AdminDirectory.
     */
    public AdminDirectory() {
        this.adminList = new ArrayList<>();
    }

    /**
     * Adds a new AdminProfile to the directory.
     * @param adminProfile the AdminProfile to add
     */
    public void addAdminProfile(AdminProfile adminProfile) {
        adminList.add(adminProfile);
    }

    /**
     * Finds an AdminProfile by its associated Person's ID.
     * @param id the ID of the Person
     * @return the AdminProfile if found, otherwise null
     */
    public AdminProfile findAdmin(String id) {
        for (AdminProfile adminProfile : adminList) {
            if (adminProfile.isMatch(id)) {
                return adminProfile;
            }
        }
        return null; // Not found
    }

    /**
     * Removes an AdminProfile from the directory by its associated Person's ID.
     * @param id the ID of the Person
     * @return true if the AdminProfile was removed, false if not found
     */
    public boolean removeAdmin(String id) {
        AdminProfile adminProfile = findAdmin(id);
        if (adminProfile != null) {
            adminList.remove(adminProfile);
            return true;
        }
        return false; // Not found
    }

    /**
     * Gets the list of all AdminProfiles in the directory.
     * @return the list of AdminProfiles
     */
    public ArrayList<AdminProfile> getAdminList() {
        return adminList;
    }
}
