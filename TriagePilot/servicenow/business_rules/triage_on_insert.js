/*
 * Business rule: TriagePilot - queue triage on new incident
 * Table: incident   When: async   Insert: true
 * Condition: u_imported=false
 */
(function executeRule(current, previous /*null when async*/) {
    new TriageClient().queueRun(current);
})(current, previous);
