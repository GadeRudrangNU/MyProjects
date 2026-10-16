/*
 * Business rule: TriagePilot - apply the approver's decision to the AI suggestion
 * Table: sysapproval_approver   When: after   Update: true
 * Condition: source_table=incident AND state CHANGES AND u_handled_by_feedback=false
 */
(function executeRule(current, previous) {
    var feedback = new TriageFeedback();
    var state = current.getValue('state');
    if (state === 'approved') {
        feedback.accept(current.getValue('document_id'), true);
    } else if (state === 'rejected') {
        feedback.reject(current.getValue('document_id'), current.getValue('comments') || 'Rejected by approver', true);
    }
})(current, previous);
