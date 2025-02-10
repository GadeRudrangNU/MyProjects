/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package model.ReportGeneration;

import java.util.Comparator;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import model.CommuterSystem.CommuterSystem;
import model.IssueManagement.Issue;
import model.IssueManagement.IssueDirectory;
import model.LineManagement.Line;
import model.LineManagement.LineDirectory;
import model.Personas.Person;
import model.Personas.TechnicianDirectory;
import model.Personas.TechnicianProfile;

/**
 *
 * @author priyankbagad
 */
public class ReportGeneration {
    public static Map<String, Object> generateReport(CommuterSystem commuterSystem) {
        Map<String, Object> reportData = new HashMap<>();

        // Line data
        LineDirectory lineDirectory = commuterSystem.getLineDirectory();
        int totalLines = lineDirectory.getLineList().size();
        long operationalLines = lineDirectory.getLineList().stream().filter(line -> "Operational".equals(line.getStatus())).count();
        long delayedLines = lineDirectory.getLineList().stream().filter(line -> "Delayed".equals(line.getStatus())).count();
        long outOfServiceLines = lineDirectory.getLineList().stream().filter(line -> "Out of Service".equals(line.getStatus())).count();

        reportData.put("Total Lines", totalLines);
        reportData.put("Operational Lines", operationalLines);
        reportData.put("Delayed Lines", delayedLines);
        reportData.put("Out of Service Lines", outOfServiceLines);

        // Issue data
        IssueDirectory issueDirectory = commuterSystem.getIssueDirectory();
        int totalIssues = issueDirectory.getIssues().size();
        long openIssues = issueDirectory.getIssues().stream().filter(issue -> "Open".equals(issue.getStatus())).count();
        long assignedIssues = issueDirectory.getIssues().stream().filter(issue -> "Assigned".equals(issue.getStatus())).count();
        long resolvedIssues = issueDirectory.getIssues().stream().filter(issue -> "Resolved".equals(issue.getStatus())).count();
        long inProgressIssues = issueDirectory.getIssues().stream().filter(issue -> "In Progress".equals(issue.getStatus())).count();

        reportData.put("Total Issues", totalIssues);
        reportData.put("Open Issues", openIssues);
        reportData.put("Assigned Issues", assignedIssues);
        reportData.put("Resolved Issues", resolvedIssues);
         reportData.put("In Progress", inProgressIssues);

        // Technician data
        TechnicianDirectory technicianDirectory = commuterSystem.getTechnicianDirectory();
        int totalTechnicians = technicianDirectory.getTechnicianList().size();
        reportData.put("Total Technicians", totalTechnicians);

            // Line-Level Analysis
    Optional<Line> longestLine = lineDirectory.getLineList().stream()
        .max(Comparator.comparingInt(Line::getNumberOfStations));
    Optional<Line> shortestLine = lineDirectory.getLineList().stream()
        .min(Comparator.comparingInt(Line::getNumberOfStations));

    reportData.put("Longest Line", longestLine.map(Line::getLineName).orElse("N/A"));
    reportData.put("Shortest Line", shortestLine.map(Line::getLineName).orElse("N/A"));

    // Technician-Level Analysis
    totalTechnicians = technicianDirectory.getTechnicianList().size();
    reportData.put("Total Technicians", totalTechnicians);

    Optional<Map.Entry<TechnicianProfile, Long>> mostAssignedTechnician = issueDirectory.getIssues().stream()
    .filter(issue -> issue.getAssignedTo() != null) // Only consider issues that are assigned
    .collect(Collectors.groupingBy(Issue::getAssignedTo, Collectors.counting())) // Group by TechnicianProfile
    .entrySet().stream()
    .max(Map.Entry.comparingByValue()); // Find the technician with the most assignments

String mostAssignedTechnicianName = mostAssignedTechnician.map(entry -> {
    TechnicianProfile technicianProfile = entry.getKey(); // Get TechnicianProfile from the entry
    Person person = technicianProfile.getPerson(); // Get the associated Person
    return person.getFirstName() + " " + person.getLastName(); // Construct the full name
}).orElse("None"); // Fallback to "None" if no technician is assigned


// Add to report data
reportData.put("Most Assigned Technician", mostAssignedTechnicianName);



        return reportData;
    }
    
}
