/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package model.LineManagement;

import java.util.ArrayList;
import java.util.List;
import model.Personas.StaffProfile;

/**
 *
 * @author priyankbagad
 */
public class LineDirectory {
    private ArrayList<Line> lineList;

    public LineDirectory() {
        lineList = new ArrayList<>();
    }

    public ArrayList<Line> getLineList() {
        return lineList;
    }

    public void addLine(Line line) {
        lineList.add(line);
    }

    public void removeLine(Line line) {
        lineList.remove(line);
    }
    // New methods
    public Line findLineById(String lineId) {
        for (Line line : lineList) {
            if (line.getLineId().equals(lineId)) {
                return line;
            }
        }
        return null;
    }

    public ArrayList<Line> getUnassignedLines() {
        ArrayList<Line> unassignedLines = new ArrayList<>();
        for (Line line : lineList) {
            if (line.getAssignedStaff() == null) {
                unassignedLines.add(line);
            }
        }
        return unassignedLines;
    }

    public void updateLine(Line lineToUpdate) {
        for (int i = 0; i < lineList.size(); i++) {
            if (lineList.get(i).getLineId().equals(lineToUpdate.getLineId())) {
                lineList.set(i, lineToUpdate);
                return;
            }
        }
    }
    public ArrayList<Line> getLinesAssignedToStaff(StaffProfile staff) {
    ArrayList<Line> assignedLines = new ArrayList<>();
    for (Line line : lineList) {
        if (line.getAssignedStaff() != null && line.getAssignedStaff().equals(staff)) {
            assignedLines.add(line);
        }
    }
    return assignedLines;
}
    public String findLineNameByStation(String stationName) {
    for (Line line : getLineList()) {
        if (line.getStartStation().equals(stationName) || line.getEndStation().equals(stationName)) {
            return line.getLineName();
        }
    }
    return "Unknown Line";
}
    public Line findLineByName(String lineName) {
        for (Line line : lineList) {
            if (line.getLineName().equalsIgnoreCase(lineName)) {
                return line;
            }
        }
        return null;
    }
    
}
