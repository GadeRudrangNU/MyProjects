package model.Personas;

import java.util.ArrayList;

public class CustomerServiceRepresentativeDirectory {
    private ArrayList<CustomerServiceRepresentativeProfile> csrList; // List of CSR profiles

    /**
     * Constructor to initialize the CustomerServiceRepresentativeDirectory.
     */
    public CustomerServiceRepresentativeDirectory() {
        this.csrList = new ArrayList<>();
    }

    /**
     * Adds a new CustomerServiceRepresentativeProfile to the directory.
     * @param csrProfile the CustomerServiceRepresentativeProfile to add
     */
    public void addCSRProfile(CustomerServiceRepresentativeProfile csrProfile) {
        csrList.add(csrProfile);
    }

    /**
     * Finds a CustomerServiceRepresentativeProfile by its associated Person's ID.
     * @param personID the ID of the Person
     * @return the CustomerServiceRepresentativeProfile if found, otherwise null
     */
    public CustomerServiceRepresentativeProfile findCSRByPersonID(String personID) {
        for (CustomerServiceRepresentativeProfile csrProfile : csrList) {
            if (csrProfile.getPerson().getId().equals(personID)) {
                return csrProfile;
            }
        }
        return null; // Not found
    }

    /**
     * Removes a CustomerServiceRepresentativeProfile from the directory by its associated Person's ID.
     * @param personID the ID of the Person
     * @return true if the CustomerServiceRepresentativeProfile was removed, false if not found
     */
    public boolean removeCSR(String personID) {
        CustomerServiceRepresentativeProfile csrProfile = findCSRByPersonID(personID);
        if (csrProfile != null) {
            csrList.remove(csrProfile);
            return true;
        }
        return false; // Not found
    }

    /**
     * Gets the list of all CustomerServiceRepresentativeProfiles in the directory.
     * @return the list of CustomerServiceRepresentativeProfiles
     */
    public ArrayList<CustomerServiceRepresentativeProfile> getCsrList() {
        return csrList;
    }
}
