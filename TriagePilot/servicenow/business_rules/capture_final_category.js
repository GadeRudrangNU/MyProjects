/*
 * Business rule: TriagePilot - remember the category a person resolved with
 * Table: incident   When: before   Update: true
 * Condition: state CHANGES TO 6 (Resolved)
 */
(function executeRule(current, previous) {
    current.setValue('u_final_category', current.getValue('category'));
})(current, previous);
