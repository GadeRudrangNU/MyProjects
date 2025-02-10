/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package model.IssueManagement;
import java.util.ArrayList;

public class IssueDirectory {
    private ArrayList<Issue> issues;

    public IssueDirectory() {
        issues = new ArrayList<>();
    }

    public void addIssue(Issue issue) {
        issues.add(issue);
    }

    public ArrayList<Issue> getIssues() {
        return issues;
    }

    public Issue findIssueByID(String issueID) {
        for (Issue issue : issues) {
            if (issue.getIssueID().equals(issueID)) {
                return issue;
            }
        }
        return null;
    }
}

