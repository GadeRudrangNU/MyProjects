/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package model.LineManagement;

import java.util.Random;
import java.util.UUID;
import model.Personas.StaffProfile;

/**
 *
 * @author priyankbagad
 */
public class Line {
        private String lineId;
        private String lineName;
    private String startStation;
    private String endStation;
    private String status; // Operational, Delayed, Out of Service
    private int numberOfStations;
    private int dutyHours;
    private StaffProfile assignedStaff;

    public Line(String lineName, String startStation, String endStation, String status, int numberOfStations) {
        this.lineName = lineName;
        this.lineId = generateRandomId();
        this.startStation = startStation;
        this.endStation = endStation;
        this.status = status;
        this.numberOfStations = numberOfStations;
        this.dutyHours = 0;
        this.assignedStaff = null;
    }
    // Method to generate random ID
    private String generateRandomId() {
        Random random = new Random();
        int randomId = random.nextInt(100) + 1; // Generate a number between 1 and 100
        return String.valueOf(randomId);
    }

    // Getters and Setters
    public String getLineName() {
        return lineName;
    }

    public void setLineName(String lineName) {
        this.lineName = lineName;
    }

    public String getStartStation() {
        return startStation;
    }

    public void setStartStation(String startStation) {
        this.startStation = startStation;
    }

    public String getEndStation() {
        return endStation;
    }

    public void setEndStation(String endStation) {
        this.endStation = endStation;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public int getNumberOfStations() {
        return numberOfStations;
    }

    public void setNumberOfStations(int numberOfStations) {
        this.numberOfStations = numberOfStations;
    }
    // New Getters and Setters for Duty Hours and Assigned Staff
    public int getDutyHours() {
        return dutyHours;
    }

    public void setDutyHours(int dutyHours) {
        this.dutyHours = dutyHours;
    }

    public StaffProfile getAssignedStaff() {
        return assignedStaff;
    }

    public void setAssignedStaff(StaffProfile assignedStaff) {
        this.assignedStaff = assignedStaff;
    }
    public String getLineId() {
        return lineId;
    }
    
}
