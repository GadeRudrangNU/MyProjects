/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/GUIForms/JPanel.java to edit this template
 */
package ui.Admin;

import java.awt.CardLayout;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.table.DefaultTableModel;
import model.CommuterSystem.CommuterSystem;
import model.IssueManagement.Issue;
import model.IssueManagement.IssueDirectory;

/**
 *
 * @author rudra
 */
public class AdminTechnicianManagementJPanel extends javax.swing.JPanel {
private JPanel userProcessContainer;
    private CommuterSystem commuterSystem;
    private Issue issue;
    /**
     * Creates new form AdminTechnicianManagementJPanel
     */
    public AdminTechnicianManagementJPanel(JPanel userProcessContainer, CommuterSystem commuterSystem, Issue issue) {
        initComponents();
        this.userProcessContainer = userProcessContainer;
        this.commuterSystem = commuterSystem;
        // Initialize the 'issue' only if it is not null
    if (issue != null) {
        this.issue = issue;
    }
        populateIssueTable();
        
    }

     void populateIssueTable() {
        DefaultTableModel model = (DefaultTableModel) jTable1.getModel();
    model.setRowCount(0);
    IssueDirectory issueDirectory = commuterSystem.getIssueDirectory();

    for (Issue issue : issueDirectory.getIssues()) {
        Object[] row = new Object[6];
        row[0] = issue.getIssueID();
        row[1] = issue.getLineName();
        row[2] = issue.getDescription();
        row[3] = issue.getStatus();
        row[4] = issue.getRaisedBy();
        
        // Checking if the issue has an assigned technician
        if (issue.getAssignedTo() != null && issue.getAssignedTo().getPerson() != null) {
            row[5] = issue.getAssignedTo().getPerson().getName();  // Safely calling getName
        } else {
            row[5] = "Not Assigned";
        }
        
        model.addRow(row);
    }
    }
    /**
     * This method is called from within the constructor to initialize the form.
     * WARNING: Do NOT modify this code. The content of this method is always
     * regenerated by the Form Editor.
     */
    @SuppressWarnings("unchecked")
    // <editor-fold defaultstate="collapsed" desc="Generated Code">//GEN-BEGIN:initComponents
    private void initComponents() {

        btnBack = new javax.swing.JButton();
        jScrollPane1 = new javax.swing.JScrollPane();
        jTable1 = new javax.swing.JTable();
        btnAssignTechnician = new javax.swing.JButton();
        lblTitle = new javax.swing.JLabel();
        btnDelete = new javax.swing.JButton();

        setBackground(new java.awt.Color(102, 153, 255));

        btnBack.setBackground(new java.awt.Color(102, 102, 102));
        btnBack.setText("<<<Back");
        btnBack.addActionListener(new java.awt.event.ActionListener() {
            public void actionPerformed(java.awt.event.ActionEvent evt) {
                btnBackActionPerformed(evt);
            }
        });

        jTable1.setModel(new javax.swing.table.DefaultTableModel(
            new Object [][] {
                {null, null, null, null, null, null},
                {null, null, null, null, null, null},
                {null, null, null, null, null, null},
                {null, null, null, null, null, null}
            },
            new String [] {
                "Issue ID", "Line Name", "Description", "Status", "Raised By", "Assigned To"
            }
        ));
        jScrollPane1.setViewportView(jTable1);

        btnAssignTechnician.setText("Assign Technician");
        btnAssignTechnician.addActionListener(new java.awt.event.ActionListener() {
            public void actionPerformed(java.awt.event.ActionEvent evt) {
                btnAssignTechnicianActionPerformed(evt);
            }
        });

        lblTitle.setFont(new java.awt.Font("Perpetua Titling MT", 1, 24)); // NOI18N
        lblTitle.setText("ASSIGN TECHNICIAN");

        btnDelete.setText("Delete Issue");
        btnDelete.addActionListener(new java.awt.event.ActionListener() {
            public void actionPerformed(java.awt.event.ActionEvent evt) {
                btnDeleteActionPerformed(evt);
            }
        });

        javax.swing.GroupLayout layout = new javax.swing.GroupLayout(this);
        this.setLayout(layout);
        layout.setHorizontalGroup(
            layout.createParallelGroup(javax.swing.GroupLayout.Alignment.LEADING)
            .addGroup(layout.createSequentialGroup()
                .addGroup(layout.createParallelGroup(javax.swing.GroupLayout.Alignment.LEADING)
                    .addGroup(layout.createSequentialGroup()
                        .addGap(44, 44, 44)
                        .addComponent(btnBack)
                        .addGap(135, 135, 135)
                        .addComponent(lblTitle))
                    .addGroup(layout.createSequentialGroup()
                        .addGap(83, 83, 83)
                        .addGroup(layout.createParallelGroup(javax.swing.GroupLayout.Alignment.LEADING, false)
                            .addComponent(jScrollPane1, javax.swing.GroupLayout.PREFERRED_SIZE, 577, javax.swing.GroupLayout.PREFERRED_SIZE)
                            .addGroup(layout.createSequentialGroup()
                                .addComponent(btnAssignTechnician)
                                .addPreferredGap(javax.swing.LayoutStyle.ComponentPlacement.RELATED, javax.swing.GroupLayout.DEFAULT_SIZE, Short.MAX_VALUE)
                                .addComponent(btnDelete, javax.swing.GroupLayout.PREFERRED_SIZE, 130, javax.swing.GroupLayout.PREFERRED_SIZE)))))
                .addContainerGap(94, Short.MAX_VALUE))
        );
        layout.setVerticalGroup(
            layout.createParallelGroup(javax.swing.GroupLayout.Alignment.LEADING)
            .addGroup(layout.createSequentialGroup()
                .addGap(34, 34, 34)
                .addGroup(layout.createParallelGroup(javax.swing.GroupLayout.Alignment.BASELINE)
                    .addComponent(btnBack)
                    .addComponent(lblTitle))
                .addGap(40, 40, 40)
                .addComponent(jScrollPane1, javax.swing.GroupLayout.PREFERRED_SIZE, 226, javax.swing.GroupLayout.PREFERRED_SIZE)
                .addGap(65, 65, 65)
                .addGroup(layout.createParallelGroup(javax.swing.GroupLayout.Alignment.BASELINE)
                    .addComponent(btnAssignTechnician)
                    .addComponent(btnDelete))
                .addContainerGap(232, Short.MAX_VALUE))
        );
    }// </editor-fold>//GEN-END:initComponents

    private void btnBackActionPerformed(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_btnBackActionPerformed
        // TODO add your handling code here:
        // Remove the current panel from the container
    userProcessContainer.remove(this);

    // Refresh and navigate to the previous panel
    CardLayout layout = (CardLayout) userProcessContainer.getLayout();
    layout.previous(userProcessContainer);

    // Refresh the container to ensure proper layout update
    userProcessContainer.revalidate();
    userProcessContainer.repaint();
    }//GEN-LAST:event_btnBackActionPerformed

    private void btnAssignTechnicianActionPerformed(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_btnAssignTechnicianActionPerformed
        // Check if a row is selected
    int selectedRow = jTable1.getSelectedRow();
    if (selectedRow < 0) {
        JOptionPane.showMessageDialog(this, "Please select an issue to assign.");
        return;
    }

    // Get the Issue ID from the selected row
    String issueID = (String) jTable1.getValueAt(selectedRow, 0);

    // Find the corresponding Issue object
    Issue selectedIssue = null;
    for (Issue issue : commuterSystem.getIssueDirectory().getIssues()) {
        if (issue.getIssueID().equals(issueID)) {
            selectedIssue = issue;
            break;
        }
    }

    if (selectedIssue == null) {
        JOptionPane.showMessageDialog(this, "Issue not found.");
        return;
    }

    // Navigate to the AssignIssueToTechnicianJPanel
    AssignIssueToTechnicianJPanel assignPanel = new AssignIssueToTechnicianJPanel(userProcessContainer, commuterSystem, selectedIssue);
    userProcessContainer.add("AssignIssueToTechnicianJPanel", assignPanel);
    CardLayout layout = (CardLayout) userProcessContainer.getLayout();
    layout.next(userProcessContainer);
        
    }//GEN-LAST:event_btnAssignTechnicianActionPerformed

    private void btnDeleteActionPerformed(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_btnDeleteActionPerformed
        // TODO add your handling code here:
        // Check if a row is selected
    int selectedRow = jTable1.getSelectedRow();
    if (selectedRow < 0) {
        JOptionPane.showMessageDialog(this, "Please select an issue to delete.", "Error", JOptionPane.ERROR_MESSAGE);
        return;
    }

    // Get the Issue ID from the selected row
    String issueID = (String) jTable1.getValueAt(selectedRow, 0);

    // Confirm the deletion
    int response = JOptionPane.showConfirmDialog(this, 
        "Are you sure you want to delete this issue?", 
        "Confirm Deletion", 
        JOptionPane.YES_NO_OPTION, 
        JOptionPane.WARNING_MESSAGE);

    if (response == JOptionPane.YES_OPTION) {
        // Find the corresponding Issue object and remove it from the IssueDirectory
        IssueDirectory issueDirectory = commuterSystem.getIssueDirectory();
        Issue issueToRemove = null;

        for (Issue issue : issueDirectory.getIssues()) {
            if (issue.getIssueID().equals(issueID)) {
                issueToRemove = issue;
                break;
            }
        }

        if (issueToRemove != null) {
            issueDirectory.getIssues().remove(issueToRemove);

            // Refresh the table
            populateIssueTable();

            // Show success message
            JOptionPane.showMessageDialog(this, "Issue deleted successfully!", "Success", JOptionPane.INFORMATION_MESSAGE);
        } else {
            JOptionPane.showMessageDialog(this, "Issue not found.", "Error", JOptionPane.ERROR_MESSAGE);
        }
    }
    }//GEN-LAST:event_btnDeleteActionPerformed


    // Variables declaration - do not modify//GEN-BEGIN:variables
    private javax.swing.JButton btnAssignTechnician;
    private javax.swing.JButton btnBack;
    private javax.swing.JButton btnDelete;
    private javax.swing.JScrollPane jScrollPane1;
    private javax.swing.JTable jTable1;
    private javax.swing.JLabel lblTitle;
    // End of variables declaration//GEN-END:variables
}
