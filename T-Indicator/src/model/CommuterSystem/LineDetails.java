/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package model.CommuterSystem;

/**
 *
 * @author rudrang
 */
public class LineDetails {
    private String start;
    private String destination;
    private String dutyHours;
    private String staffAssigned;

    public LineDetails(String start, String destination, String dutyHours) {
        this.start = start;
        this.destination = destination;
        this.dutyHours = dutyHours;
        this.staffAssigned = null;
    }

    public String getStart() {
        return start;
    }

    public void setStart(String start) {
        this.start = start;
    }

    public String getDestination() {
        return destination;
    }

    public void setDestination(String destination) {
        this.destination = destination;
    }

    public String getDutyHours() {
        return dutyHours;
    }

    public void setDutyHours(String dutyHours) {
        this.dutyHours = dutyHours;
    }
    public String getStaffAssigned() {
        return staffAssigned;
    }

    public void setStaffAssigned(String staffAssigned) {
        this.staffAssigned = staffAssigned;
    }
}

