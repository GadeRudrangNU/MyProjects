package model.Personas;

import java.util.ArrayList;

public class IssueManagerDirectory {
    private ArrayList<IssueManagerProfile> issueManagerList; // List of Issue Manager profiles

    /**
     * Constructor to initialize the IssueManagerDirectory.
     */
    public IssueManagerDirectory() {
        this.issueManagerList = new ArrayList<>();
    }

    /**
     * Adds a new IssueManagerProfile to the directory.
     * @param issueManagerProfile the IssueManagerProfile to add
     */
    public void addIssueManagerProfile(IssueManagerProfile issueManagerProfile) {
        issueManagerList.add(issueManagerProfile);
    }

    /**
     * Finds an IssueManagerProfile by its associated Person's ID.
     * @param personID the ID of the Person
     * @return the IssueManagerProfile if found, otherwise null
     */
    public IssueManagerProfile findIssueManagerByPersonID(String personID) {
        for (IssueManagerProfile issueManagerProfile : issueManagerList) {
            if (issueManagerProfile.getPerson().getId().equals(personID)) {
                return issueManagerProfile;
            }
        }
        return null; // Not found
    }

    /**
     * Removes an IssueManagerProfile from the directory by its associated Person's ID.
     * @param personID the ID of the Person
     * @return true if the IssueManagerProfile was removed, false if not found
     */
    public boolean removeIssueManager(String personID) {
        IssueManagerProfile issueManagerProfile = findIssueManagerByPersonID(personID);
        if (issueManagerProfile != null) {
            issueManagerList.remove(issueManagerProfile);
            return true;
        }
        return false; // Not found
    }

    /**
     * Gets the list of all IssueManagerProfiles in the directory.
     * @return the list of IssueManagerProfiles
     */
    public ArrayList<IssueManagerProfile> getIssueManagerList() {
        return issueManagerList;
    }
}
