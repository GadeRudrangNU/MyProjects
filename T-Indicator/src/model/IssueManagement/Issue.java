/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package model.IssueManagement;

/**
 *
 * @author priyankbagad
 */
import java.util.ArrayList;
import model.Personas.TechnicianProfile;

public class Issue {
    private String issueID;
    private String lineName;
    private String stationName;
    private String description;
    private String status; // Open, Assigned, In Progress, Completed
    private String raisedBy; // ID of staff who raised the issue
    private TechnicianProfile assignedTo; // ID of the technician assigned to resolve
    private String title;
private String priority;
  
    public Issue(String issueID, String lineName, String description, String status, String raisedBy) {
        this.issueID = issueID;
        this.lineName = lineName;
        this.stationName = stationName;
        this.description = description;
        this.status = status;
        this.raisedBy = raisedBy;
        this.assignedTo = null; // Initially unassigned
      
    }

    // Add a comment to the issue
   

    

    // Getters and Setters
    public String getIssueID() { return issueID; }
    public String getStationName() { return stationName; }
    public String getDescription() { return description; }
    public String getStatus() { return status; }
    public void setStatus(String status) {
        this.status = status;
    }
    public String getRaisedBy() { return raisedBy; }
    public TechnicianProfile getAssignedTo() { return assignedTo; }
    public void setAssignedTo(TechnicianProfile assignedTo) { this.assignedTo = assignedTo; }
   public String getTitle() {
    return title;
}
   // Getters and setters
    public String getLineName() {
        return lineName;
    }

    public void setLineName(String lineName) {
        this.lineName = lineName;
    }


public void setTitle(String title) {
    this.title = title;
}

public String getPriority() {
    return priority;
}

public void setPriority(String priority) {
    this.priority = priority;
}
}
