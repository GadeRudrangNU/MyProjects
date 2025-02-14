/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/GUIForms/JPanel.java to edit this template
 */
package ui.Admin;

import java.awt.CardLayout;
import java.util.List;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.table.DefaultTableModel;
import model.CommuterSystem.CommuterSystem;
import model.CommuterSystem.LineDetails;
import model.LineManagement.Line;

/**
 *
 * @author rudra
 */
public class AdminStaffManagementJPanel extends javax.swing.JPanel {
private JPanel userProcessContainer;
    private CommuterSystem commuterSystem;
    /**
     * Creates new form AdminStaffManagementJPanel
     */
    public AdminStaffManagementJPanel(JPanel userProcessContainer, CommuterSystem commuterSystem) {
        initComponents();
        this.userProcessContainer = userProcessContainer;
        this.commuterSystem = commuterSystem;
        populateTable();
    }
      void populateTable() {
        DefaultTableModel model = (DefaultTableModel) jTable1.getModel();
        model.setRowCount(0); // Clear existing rows

        List<Line> lineList = commuterSystem.getLineDirectory().getLineList();

        for (Line line : lineList) {
            Object[] row = new Object[5];
            row[0] = line.getLineId();
            row[1] = line.getStartStation();
            row[2] = line.getEndStation();
            row[3] = line.getDutyHours();
            row[4] = line.getAssignedStaff() == null ? "Unassigned" : line.getAssignedStaff().getPerson().getName();

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
        btnAssignStaff = new javax.swing.JButton();

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
                {null, null, null, null, null},
                {null, null, null, null, null},
                {null, null, null, null, null},
                {null, null, null, null, null}
            },
            new String [] {
                "Line ID", "Start Station", "End Station", "Duty Hours", "Assigned To"
            }
        ));
        jScrollPane1.setViewportView(jTable1);
        if (jTable1.getColumnModel().getColumnCount() > 0) {
            jTable1.getColumnModel().getColumn(0).setHeaderValue("Line ID");
        }

        btnAssignStaff.setText("Assign Staff");
        btnAssignStaff.addActionListener(new java.awt.event.ActionListener() {
            public void actionPerformed(java.awt.event.ActionEvent evt) {
                btnAssignStaffActionPerformed(evt);
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
                        .addComponent(btnBack))
                    .addGroup(layout.createSequentialGroup()
                        .addGap(133, 133, 133)
                        .addGroup(layout.createParallelGroup(javax.swing.GroupLayout.Alignment.LEADING)
                            .addComponent(btnAssignStaff)
                            .addComponent(jScrollPane1, javax.swing.GroupLayout.PREFERRED_SIZE, 438, javax.swing.GroupLayout.PREFERRED_SIZE))))
                .addContainerGap(160, Short.MAX_VALUE))
        );
        layout.setVerticalGroup(
            layout.createParallelGroup(javax.swing.GroupLayout.Alignment.LEADING)
            .addGroup(layout.createSequentialGroup()
                .addGap(36, 36, 36)
                .addComponent(btnBack)
                .addGap(27, 27, 27)
                .addComponent(jScrollPane1, javax.swing.GroupLayout.PREFERRED_SIZE, 148, javax.swing.GroupLayout.PREFERRED_SIZE)
                .addGap(71, 71, 71)
                .addComponent(btnAssignStaff)
                .addContainerGap(203, Short.MAX_VALUE))
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

    private void btnAssignStaffActionPerformed(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_btnAssignStaffActionPerformed
        // TODO add your handling code here:
         int selectedRow = jTable1.getSelectedRow();
    if (selectedRow < 0) {
        JOptionPane.showMessageDialog(null, "Please select a line to assign staff.", "Warning", JOptionPane.WARNING_MESSAGE);
        return;
    }

    // Retrieve selected line ID
    String lineId = (String) jTable1.getValueAt(selectedRow, 0);

    // Retrieve the selected line object
    Line selectedLine = commuterSystem.getLineDirectory().findLineById(lineId);

    // Navigate to AssignLineToStaffJPanel
    AssignLineToStaffJPanel assignLinePanel = new AssignLineToStaffJPanel(userProcessContainer, commuterSystem, selectedLine, this);
    userProcessContainer.add("AssignLineToStaffJPanel", assignLinePanel);

    CardLayout layout = (CardLayout) userProcessContainer.getLayout();
    layout.next(userProcessContainer);
    }//GEN-LAST:event_btnAssignStaffActionPerformed


    // Variables declaration - do not modify//GEN-BEGIN:variables
    private javax.swing.JButton btnAssignStaff;
    private javax.swing.JButton btnBack;
    private javax.swing.JScrollPane jScrollPane1;
    private javax.swing.JTable jTable1;
    // End of variables declaration//GEN-END:variables
}
