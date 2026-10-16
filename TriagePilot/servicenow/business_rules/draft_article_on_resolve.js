/*
 * Business rule: TriagePilot - ask for a knowledge article when an incident is resolved
 * Table: incident   When: async   Update: true
 * Condition: state CHANGES TO 6 AND u_imported=false AND close_notes IS NOT EMPTY
 */
(function executeRule(current, previous) {
    new TriageClient().requestArticle(current);
})(current, previous);
