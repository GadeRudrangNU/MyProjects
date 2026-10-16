/*
 * Scripted REST API: TriagePilot   Resource: GET /api/x_tp/triage/metrics
 * Feeds the dashboard widgets.
 */
(function process(request, response) {
    response.setStatus(200);
    response.setBody({ result: new TriageMetrics().summary() });
})(request, response);
