package model.CommuterSystem;

import model.ComplaintManagement.ComplaintDirectory;
import model.Personas.*;
import model.UserManagement.UserDirectory;
import model.IssueManagement.IssueDirectory;
import model.LineManagement.LineDirectory;
import model.NotificationManagement.NotificationDirectory;

/**
 *
 * @author priyankbagad/Rudrang/Manasi
 */
public class CommuterSystem {

    private String name;
    private PersonDirectory personDirectory;
    private StaffDirectory staffDirectory;
    private AdminDirectory adminDirectory;
    private IssueDirectory issueDirectory;
    private UserDirectory userDirectory;
    private LineDirectory lineDirectory;
    private TechnicianDirectory technicianDirectory;
    private LineManagerDirectory lineManagerDirectory;
    private AnalystDirectory analystDirectory;
    private CustomerServiceRepresentativeDirectory csrDirectory;
    private IssueManagerDirectory issueManagerDirectory;
    private NotificationDirectory notificationDirectory;
    private ComplaintDirectory complaintDirectory;

    public CommuterSystem(String n) {
        name = n;
        personDirectory = new PersonDirectory();
        staffDirectory = new StaffDirectory();
        adminDirectory = new AdminDirectory();
        userDirectory = new UserDirectory(personDirectory);
        technicianDirectory = new TechnicianDirectory();
        issueDirectory = new IssueDirectory();
        lineDirectory = new LineDirectory();
        lineManagerDirectory = new LineManagerDirectory();
        analystDirectory = new AnalystDirectory();
        csrDirectory = new CustomerServiceRepresentativeDirectory();
        issueManagerDirectory = new IssueManagerDirectory();
        notificationDirectory = new NotificationDirectory();
        complaintDirectory = new ComplaintDirectory();
    }

    // Getters for all directories
    public PersonDirectory getPersonDirectory() {
        return personDirectory;
    }
    public NotificationDirectory getNotificationDirectory() {
    return notificationDirectory;
    }

    public ComplaintDirectory getComplaintDirectory() {
    return complaintDirectory;
    }

    public LineDirectory getLineDirectory() {
        return lineDirectory;
    }

    public StaffDirectory getStaffDirectory() {
        return staffDirectory;
    }

    public AdminDirectory getAdminDirectory() {
        return adminDirectory;
    }

    public IssueDirectory getIssueDirectory() {
        return issueDirectory;
    }

    public UserDirectory getUserDirectory() {
        return userDirectory;
    }

    public TechnicianDirectory getTechnicianDirectory() {
        return technicianDirectory;
    }

    public LineManagerDirectory getLineManagerDirectory() {
        return lineManagerDirectory;
    }

    public AnalystDirectory getAnalystDirectory() {
        return analystDirectory;
    }

    public CustomerServiceRepresentativeDirectory getCsrDirectory() {
        return csrDirectory;
    }

    public IssueManagerDirectory getIssueManagerDirectory() {
        return issueManagerDirectory;
    }

    public TechnicianProfile findTechnicianByPersonID(String personID) {
        return technicianDirectory.findTechnicianByPersonID(personID);
    }
}
