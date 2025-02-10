package model.CommuterSystem;

import java.util.UUID;
import model.IssueManagement.Issue;
import model.IssueManagement.IssueDirectory;
import model.Personas.*;
import model.UserManagement.*;
import model.LineManagement.Line;
import model.LineManagement.LineDirectory;
import model.NotificationManagement.NotificationDirectory;

public class ConfigureCommuterSystem {
    public static CommuterSystem configure() {
        // Create CommuterSystem
        CommuterSystem commuterSystem = new CommuterSystem("MBTA");

        // Access directories
        PersonDirectory personDirectory = commuterSystem.getPersonDirectory();
        AdminDirectory adminDirectory = commuterSystem.getAdminDirectory();
        StaffDirectory staffDirectory = commuterSystem.getStaffDirectory();
        TechnicianDirectory technicianDirectory = commuterSystem.getTechnicianDirectory();
        UserDirectory userDirectory = commuterSystem.getUserDirectory();
        IssueDirectory issueDirectory = commuterSystem.getIssueDirectory();
        LineDirectory lineDirectory = commuterSystem.getLineDirectory();
        LineManagerDirectory lineManagerDirectory = commuterSystem.getLineManagerDirectory();
        AnalystDirectory analystDirectory = commuterSystem.getAnalystDirectory();
        CustomerServiceRepresentativeDirectory csrDirectory = commuterSystem.getCsrDirectory();
        IssueManagerDirectory issueManagerDirectory = commuterSystem.getIssueManagerDirectory();
        NotificationDirectory notificationDirectory = commuterSystem.getNotificationDirectory();
        


        // Create Persons
        Person adminPerson = new Person("1", "Admin","User", "admin@example.com");
        Person staffPerson = new Person("2", "Staff","User", "staff@example.com");
        Person technicianPerson = new Person("3", "Technician","User", "tech@example.com");
        
        

        // Add Persons to PersonDirectory
       personDirectory.addPerson(adminPerson);
personDirectory.addPerson(staffPerson);
personDirectory.addPerson(technicianPerson);

        // Create Users and assign to Persons
        User adminUser = new User("admin1", "Admin@pass", "Admin");
        User staffUser = new User("staff1", "Staff@pass", "Staff");
        User technicianUser = new User("tech1", "Tech@pass", "Technician");

        adminPerson.setUser(adminUser);
        staffPerson.setUser(staffUser);
        technicianPerson.setUser(technicianUser);

        // Add Users to UserDirectory
        userDirectory.addUser(adminUser);
        userDirectory.addUser(staffUser);
        userDirectory.addUser(technicianUser);

        // Create Profiles and add to respective directories
        AdminProfile adminProfile = new AdminProfile(adminPerson);
        adminDirectory.addAdminProfile(adminProfile);

        StaffProfile staffProfile = new StaffProfile(staffPerson);
        staffDirectory.addStaffProfile(staffProfile);

        TechnicianProfile technicianProfile = new TechnicianProfile(technicianPerson);
        technicianDirectory.addTechnicianProfile(technicianProfile);
        
        
        
        
        
                // Add Line Manager
        Person lineManagerPerson = new Person("5", "Line", "Manager", "linemgr@example.com");
        personDirectory.addPerson(lineManagerPerson);
        User lineMgrUser = new User("lineMgr1", "Linemgr@pass", "LineManager");
        lineManagerPerson.setUser(lineMgrUser);
        userDirectory.addUser(lineMgrUser);
        LineManagerProfile lineManagerProfile = new LineManagerProfile(lineManagerPerson);
        lineManagerDirectory.addLineManagerProfile(lineManagerProfile);
       
        Person generalPerson = new Person("100", "General", "User", "general.user@mbta.com");
        personDirectory.addPerson(generalPerson);
        User generalUser = new User("general1", "General@pass", "GeneralUser");
        generalPerson.setUser(generalUser);
        userDirectory.addUser(generalUser);
        

        // Add Analyst
        Person analystPerson = new Person("6", "Analyst", "Smith", "analyst@example.com");
        personDirectory.addPerson(analystPerson);
        User analystUser = new User("analyst1", "Analyst@pass", "Analyst");
        analystPerson.setUser(analystUser);
        userDirectory.addUser(lineMgrUser);
        AnalystProfile analystProfile = new AnalystProfile(analystPerson);
        analystDirectory.addAnalystProfile(analystProfile);
        
        Person rudrangPerson = new Person("10", "Rudrang", "Gade", "rudrang.gade@mbta.com");
        personDirectory.addPerson(rudrangPerson);
        User rudrangUser = new User("rudrang1", "Rudrang@pass", "Technician");
        rudrangPerson.setUser(rudrangUser);
        userDirectory.addUser(rudrangUser);
        TechnicianProfile rudrangTechnicianProfile = new TechnicianProfile(rudrangPerson);
        technicianDirectory.addTechnicianProfile(rudrangTechnicianProfile);
        
        
        // Add Manasi Mhaske as a Staff
        Person manasiPerson = new Person("11", "Manasi", "Mhaske", "manasi.mhaske@mbta.com");
        personDirectory.addPerson(manasiPerson);
        User manasiUser = new User("manasi1", "Manasi@pass", "Staff");
        manasiPerson.setUser(manasiUser);
        userDirectory.addUser(manasiUser);
        StaffProfile manasiStaffProfile = new StaffProfile(manasiPerson);
        staffDirectory.addStaffProfile(manasiStaffProfile);
        
        

        
        

        // Add Customer Service Representatives (CSRs)
Person csrPerson1 = new Person("7", "Emily", "Johnson", "emily.johnson@csr.com");
personDirectory.addPerson(csrPerson1);
User csrUser1 = new User("csr1", "Csr@pass", "CustomerServiceRepresentative");
csrPerson1.setUser(csrUser1);
userDirectory.addUser(csrUser1);
CustomerServiceRepresentativeProfile csrProfile1 = new CustomerServiceRepresentativeProfile(csrPerson1);
csrDirectory.addCSRProfile(csrProfile1);

Person csrPerson2 = new Person("8", "Chris", "Brown", "chris.brown@csr.com");
personDirectory.addPerson(csrPerson2);
User csrUser2 = new User("csr2", "Csr@pass", "CustomerServiceRepresentative");
csrPerson2.setUser(csrUser2);
userDirectory.addUser(csrUser2);
CustomerServiceRepresentativeProfile csrProfile2 = new CustomerServiceRepresentativeProfile(csrPerson2);
csrDirectory.addCSRProfile(csrProfile2);

// Add Issue Manager
Person issueManagerPerson = new Person("9", "Michael", "Brown", "issuemgr@example.com");
personDirectory.addPerson(issueManagerPerson);
User issueMgrUser = new User("issueMgr1", "Issuemgr@pass", "IssueManager");
issueManagerPerson.setUser(issueMgrUser);
userDirectory.addUser(issueMgrUser);
IssueManagerProfile issueManagerProfile = new IssueManagerProfile(issueManagerPerson);
issueManagerDirectory.addIssueManagerProfile(issueManagerProfile);
        
        
        // Create demo issues
        Issue issue1 = new Issue("1", "Red Line", "Track maintenance needed", "Open", "Staff1");
        Issue issue2 = new Issue("2", "Blue Line", "Electrical failure", "Assigned", "Staff2");

        // Use the existing technicianProfile to assign the technician to the issues
        issue2.setAssignedTo(technicianProfile); // Assigning technician profile to issue

        Issue issue3 = new Issue("3", "Orange Line", "Signal system malfunction", "In Progress", "Staff3");
        issue3.setAssignedTo(technicianProfile); // Assigning technician profile to issue

        Issue issue4 = new Issue("4", "Green Line", "Broken escalator", "Resolved", "Staff4");
        issue4.setAssignedTo(technicianProfile); // Assigning technician profile to issue
       

        // Add issues to directory
        issueDirectory.addIssue(issue1);
        issueDirectory.addIssue(issue2);
        issueDirectory.addIssue(issue3);
        issueDirectory.addIssue(issue4);
        
        //ADDING LINES MANAGEMENT DATA
          // Add Notifications
       notificationDirectory.addNotification("1","Service Alert", "The Blue Line is delayed by 15 minutes due to maintenance.");
    notificationDirectory.addNotification("2","Station Closure", "The Forest Hills Station is temporarily closed for repairs.");
    notificationDirectory.addNotification("3","Weather Update", "Severe weather may cause delays on all lines. Stay safe!");
    notificationDirectory.addNotification("4","New Timings", "Red Line now operates from 5 AM to 12 AM daily.");
    notificationDirectory.addNotification("5","Discount Alert", "Weekend travel discounts are now available for all passengers.");

        // Generate demo data for lines
        generateDemoLines(lineDirectory);
        
      

        // Output a success message
        System.out.println("Demo data configured successfully!");
       
        
        return commuterSystem;
    }
    //Funtion to generate demo lines
      private static void generateDemoLines(LineDirectory lineDirectory) {
        // Add sample lines
        lineDirectory.addLine(new Line("Red Line", "Alewife", "Ashmont/Braintree", "Operational", 22));
        lineDirectory.addLine(new Line("Blue Line", "Wonderland", "Bowdoin", "Delayed", 12));
        lineDirectory.addLine(new Line("Green Line", "Lechmere", "Union Square", "Operational", 19));
        lineDirectory.addLine(new Line("Orange Line", "Oak Grove", "Forest Hills", "Out of Service", 20));

        System.out.println("Demo lines added to the directory:");
        }
}
