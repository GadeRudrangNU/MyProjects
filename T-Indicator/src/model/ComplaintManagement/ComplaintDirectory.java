/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package model.ComplaintManagement;

/**
 *
 * @author priyankbagad
 */

import java.util.ArrayList;

public class ComplaintDirectory {
    private ArrayList<Complaint> complaintList;

    public ComplaintDirectory() {
        this.complaintList = new ArrayList<>();
    }

    public void addComplaint(String name, String email, String description) {
        Complaint complaint = new Complaint(name, email, description);
        complaintList.add(complaint);
    }

    public ArrayList<Complaint> getComplaints() {
        return complaintList;
    }
}

