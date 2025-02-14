/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/GUIForms/JPanel.java to edit this template
 */
package ui.Admin;

import java.awt.CardLayout;
import javax.swing.JPanel;
import javax.swing.SwingUtilities;
import model.CommuterSystem.CommuterSystem;
import ui.LineManagement.ViewEditLinePanel;
import ui.MainJFrame1;

/**
 *
 * @author rudra
 */
public class AdminJPanel extends javax.swing.JPanel {
private JPanel userProcessContainer;
    private CommuterSystem commuterSystem;
    /**
     * Creates new form AdminJPanel
     */
    public AdminJPanel(JPanel userProcessContainer,CommuterSystem commuterSystem) {
        initComponents();
        this.userProcessContainer = userProcessContainer;
        this.commuterSystem = commuterSystem;
    }

    /**
     * This method is called from within the constructor to initialize the form.
     * WARNING: Do NOT modify this code. The content of this method is always
     * regenerated by the Form Editor.
     */
    @SuppressWarnings("unchecked")
    // <editor-fold defaultstate="collapsed" desc="Generated Code">//GEN-BEGIN:initComponents
    private void initComponents() {

        btnUserManagement = new javax.swing.JButton();
        btnStaffManagement = new javax.swing.JButton();
        btnTechnicianManagement = new javax.swing.JButton();
        btnLineManagement = new javax.swing.JButton();
        btnGenerateReport = new javax.swing.JButton();
        lblTitle = new javax.swing.JLabel();
        btnLogout = new javax.swing.JButton();
        jButton1 = new javax.swing.JButton();
        jLabel1 = new javax.swing.JLabel();

        setBackground(new java.awt.Color(102, 153, 255));

        btnUserManagement.setText("User Management");
        btnUserManagement.addActionListener(new java.awt.event.ActionListener() {
            public void actionPerformed(java.awt.event.ActionEvent evt) {
                btnUserManagementActionPerformed(evt);
            }
        });

        btnStaffManagement.setText("Staff Management");
        btnStaffManagement.addActionListener(new java.awt.event.ActionListener() {
            public void actionPerformed(java.awt.event.ActionEvent evt) {
                btnStaffManagementActionPerformed(evt);
            }
        });

        btnTechnicianManagement.setText("Technician Management");
        btnTechnicianManagement.addActionListener(new java.awt.event.ActionListener() {
            public void actionPerformed(java.awt.event.ActionEvent evt) {
                btnTechnicianManagementActionPerformed(evt);
            }
        });

        btnLineManagement.setText("LineManagement");
        btnLineManagement.addActionListener(new java.awt.event.ActionListener() {
            public void actionPerformed(java.awt.event.ActionEvent evt) {
                btnLineManagementActionPerformed(evt);
            }
        });

        btnGenerateReport.setText("Generate Report");
        btnGenerateReport.addActionListener(new java.awt.event.ActionListener() {
            public void actionPerformed(java.awt.event.ActionEvent evt) {
                btnGenerateReportActionPerformed(evt);
            }
        });

        lblTitle.setFont(new java.awt.Font("Perpetua Titling MT", 1, 24)); // NOI18N
        lblTitle.setText("Hello Admin ");

        btnLogout.setBackground(new java.awt.Color(102, 102, 102));
        btnLogout.setText("Logout");
        btnLogout.addActionListener(new java.awt.event.ActionListener() {
            public void actionPerformed(java.awt.event.ActionEvent evt) {
                btnLogoutActionPerformed(evt);
            }
        });

        jButton1.setText("Add a Notification");
        jButton1.addActionListener(new java.awt.event.ActionListener() {
            public void actionPerformed(java.awt.event.ActionEvent evt) {
                jButton1ActionPerformed(evt);
            }
        });

        jLabel1.setIcon(new javax.swing.ImageIcon(getClass().getResource("/image/admin11.png"))); // NOI18N

        javax.swing.GroupLayout layout = new javax.swing.GroupLayout(this);
        this.setLayout(layout);
        layout.setHorizontalGroup(
            layout.createParallelGroup(javax.swing.GroupLayout.Alignment.LEADING)
            .addGroup(layout.createSequentialGroup()
                .addGap(123, 123, 123)
                .addGroup(layout.createParallelGroup(javax.swing.GroupLayout.Alignment.LEADING, false)
                    .addComponent(jButton1, javax.swing.GroupLayout.DEFAULT_SIZE, javax.swing.GroupLayout.DEFAULT_SIZE, Short.MAX_VALUE)
                    .addComponent(btnGenerateReport, javax.swing.GroupLayout.DEFAULT_SIZE, javax.swing.GroupLayout.DEFAULT_SIZE, Short.MAX_VALUE)
                    .addComponent(btnLineManagement, javax.swing.GroupLayout.DEFAULT_SIZE, javax.swing.GroupLayout.DEFAULT_SIZE, Short.MAX_VALUE)
                    .addComponent(btnTechnicianManagement, javax.swing.GroupLayout.DEFAULT_SIZE, javax.swing.GroupLayout.DEFAULT_SIZE, Short.MAX_VALUE)
                    .addComponent(btnStaffManagement, javax.swing.GroupLayout.DEFAULT_SIZE, javax.swing.GroupLayout.DEFAULT_SIZE, Short.MAX_VALUE)
                    .addComponent(btnUserManagement, javax.swing.GroupLayout.DEFAULT_SIZE, javax.swing.GroupLayout.DEFAULT_SIZE, Short.MAX_VALUE)
                    .addComponent(lblTitle, javax.swing.GroupLayout.DEFAULT_SIZE, javax.swing.GroupLayout.DEFAULT_SIZE, Short.MAX_VALUE))
                .addGap(53, 53, 53)
                .addGroup(layout.createParallelGroup(javax.swing.GroupLayout.Alignment.LEADING)
                    .addComponent(btnLogout)
                    .addComponent(jLabel1, javax.swing.GroupLayout.PREFERRED_SIZE, 270, javax.swing.GroupLayout.PREFERRED_SIZE))
                .addContainerGap(236, Short.MAX_VALUE))
        );

        layout.linkSize(javax.swing.SwingConstants.HORIZONTAL, new java.awt.Component[] {btnGenerateReport, btnLineManagement, btnStaffManagement, btnTechnicianManagement, btnUserManagement, jButton1});

        layout.setVerticalGroup(
            layout.createParallelGroup(javax.swing.GroupLayout.Alignment.LEADING)
            .addGroup(layout.createSequentialGroup()
                .addGroup(layout.createParallelGroup(javax.swing.GroupLayout.Alignment.LEADING)
                    .addGroup(layout.createSequentialGroup()
                        .addGap(52, 52, 52)
                        .addGroup(layout.createParallelGroup(javax.swing.GroupLayout.Alignment.BASELINE)
                            .addComponent(lblTitle, javax.swing.GroupLayout.PREFERRED_SIZE, 44, javax.swing.GroupLayout.PREFERRED_SIZE)
                            .addComponent(btnLogout))
                        .addGap(51, 51, 51)
                        .addComponent(btnUserManagement)
                        .addGap(30, 30, 30)
                        .addComponent(btnStaffManagement)
                        .addGap(32, 32, 32)
                        .addComponent(btnTechnicianManagement)
                        .addGap(29, 29, 29)
                        .addComponent(btnLineManagement)
                        .addGap(24, 24, 24)
                        .addComponent(btnGenerateReport)
                        .addGap(18, 18, 18)
                        .addComponent(jButton1))
                    .addGroup(layout.createSequentialGroup()
                        .addGap(167, 167, 167)
                        .addComponent(jLabel1, javax.swing.GroupLayout.PREFERRED_SIZE, 242, javax.swing.GroupLayout.PREFERRED_SIZE)))
                .addContainerGap(155, Short.MAX_VALUE))
        );
    }// </editor-fold>//GEN-END:initComponents

    private void btnUserManagementActionPerformed(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_btnUserManagementActionPerformed
        // TODO add your handling code here:
        // Navigate to AdminUserManagementJPanel
    AdminUserManagementJPanel userManagementPanel = new AdminUserManagementJPanel(userProcessContainer, commuterSystem);
    userProcessContainer.add("AdminUserManagementJPanel", userManagementPanel);
    CardLayout layout = (CardLayout) userProcessContainer.getLayout();
    layout.show(userProcessContainer, "AdminUserManagementJPanel");
    }//GEN-LAST:event_btnUserManagementActionPerformed

    private void btnStaffManagementActionPerformed(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_btnStaffManagementActionPerformed
        // TODO add your handling code here:
        // Navigate to AdminStaffManagementJPanel
    AdminStaffManagementJPanel staffManagementPanel = new AdminStaffManagementJPanel(userProcessContainer, commuterSystem);
    userProcessContainer.add("AdminStaffManagementJPanel", staffManagementPanel);
    CardLayout layout = (CardLayout) userProcessContainer.getLayout();
    layout.show(userProcessContainer, "AdminStaffManagementJPanel");
    }//GEN-LAST:event_btnStaffManagementActionPerformed

    private void btnTechnicianManagementActionPerformed(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_btnTechnicianManagementActionPerformed
        // TODO add your handling code here:
        // Navigate to AdminTechnicianManagementJPanel
    AdminTechnicianManagementJPanel technicianManagementPanel = 
        new AdminTechnicianManagementJPanel(userProcessContainer, commuterSystem, null);
    userProcessContainer.add("AdminTechnicianManagementJPanel", technicianManagementPanel);
    CardLayout layout = (CardLayout) userProcessContainer.getLayout();
    layout.show(userProcessContainer, "AdminTechnicianManagementJPanel");
    }//GEN-LAST:event_btnTechnicianManagementActionPerformed

    private void btnLineManagementActionPerformed(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_btnLineManagementActionPerformed
        // TODO add your handling code here:
        // Navigate to AdminLineManagementJPanel
    ViewEditLinePanel lineManagementPanel = new ViewEditLinePanel(userProcessContainer, commuterSystem);
    userProcessContainer.add("ViewEditLinePanel", lineManagementPanel);
    CardLayout layout = (CardLayout) userProcessContainer.getLayout();
    layout.show(userProcessContainer, "ViewEditLinePanel");
    }//GEN-LAST:event_btnLineManagementActionPerformed

    private void btnGenerateReportActionPerformed(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_btnGenerateReportActionPerformed
        // TODO add your handling code here:
        // Navigate to AdminGenerateReportJPanel
    AdminGenerateReportJPanel generateReportPanel = new AdminGenerateReportJPanel(userProcessContainer, commuterSystem);
    userProcessContainer.add("AdminGenerateReportJPanel", generateReportPanel);
    CardLayout layout = (CardLayout) userProcessContainer.getLayout();
    layout.show(userProcessContainer, "AdminGenerateReportJPanel");
    }//GEN-LAST:event_btnGenerateReportActionPerformed

    private void btnLogoutActionPerformed(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_btnLogoutActionPerformed
        // TODO add your handling code here:
      // Display confirmation dialog
    int response = javax.swing.JOptionPane.showConfirmDialog(this, 
            "Are you sure you want to logout?", 
            "Logout Confirmation", 
            javax.swing.JOptionPane.YES_NO_OPTION);
    
    // If the user clicks "Yes", navigate to the MainJFrame1
    if (response == javax.swing.JOptionPane.YES_OPTION) {
        // Assuming you have a reference to MainJFrame1 (replace with your actual class or frame)
        MainJFrame1 mainFrame = new MainJFrame1(commuterSystem);  // Initialize your MainJFrame1 here with the commuterSystem
        mainFrame.setVisible(true);  // Show the main frame
        
        // Close the current Admin panel
        java.awt.Window win = SwingUtilities.getWindowAncestor(this);
        if (win != null) {
            win.dispose();  // Close the current window (AdminJPanel)
        }
    }
    }//GEN-LAST:event_btnLogoutActionPerformed

    private void jButton1ActionPerformed(java.awt.event.ActionEvent evt) {//GEN-FIRST:event_jButton1ActionPerformed
        // TODO add your handling code here:
        // Create an instance of AddNotificationJPanel
    AddNotificationJPanel addNotificationPanel = new AddNotificationJPanel(userProcessContainer, commuterSystem);

    // Add the panel to the userProcessContainer
    userProcessContainer.add("AddNotificationJPanel", addNotificationPanel);

    // Switch to the AddNotificationJPanel
    CardLayout layout = (CardLayout) userProcessContainer.getLayout();
    layout.show(userProcessContainer, "AddNotificationJPanel");
    }//GEN-LAST:event_jButton1ActionPerformed


    // Variables declaration - do not modify//GEN-BEGIN:variables
    private javax.swing.JButton btnGenerateReport;
    private javax.swing.JButton btnLineManagement;
    private javax.swing.JButton btnLogout;
    private javax.swing.JButton btnStaffManagement;
    private javax.swing.JButton btnTechnicianManagement;
    private javax.swing.JButton btnUserManagement;
    private javax.swing.JButton jButton1;
    private javax.swing.JLabel jLabel1;
    private javax.swing.JLabel lblTitle;
    // End of variables declaration//GEN-END:variables
}
