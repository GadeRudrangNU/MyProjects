(function (outputs, steps, params, stepResult, assertEqual) {
    function postResult(user, password, body) {
        var msg = new sn_ws.RESTMessageV2();
        msg.setEndpoint(gs.getProperty('glide.servlet.uri') + 'api/x_tp/triage/result');
        msg.setHttpMethod('POST');
        msg.setBasicAuth(user, password);
        msg.setRequestHeader('Content-Type', 'application/json');
        msg.setRequestBody(JSON.stringify(body));
        return msg.execute();
    }

    var inc = new GlideRecord('incident');
    inc.initialize();
    inc.setValue('short_description', 'ATF: callback test');
    inc.setValue('u_imported', 'true');
    inc.setValue('priority', '4');
    var incId = inc.insert();

    var run = new GlideRecord('x_tp_ai_triage_run');
    run.initialize();
    run.setValue('incident', incId);
    run.setValue('run_key', incId + ':0');
    run.setValue('status', 'queued');
    run.setValue('outcome', 'pending');
    var runId = run.insert();

    var body = {
        run_sys_id: runId, incident_sys_id: incId, status: 'completed', category: 'Storage',
        assignment_group: 'TP Storage Team', confidence: 0.91, path: 'fast', reasoning: 'test',
        reply_draft: 'Thanks, the storage team will pick this up.', cited_articles: ['KB0010021'], latency_ms: 1200, attempts: 1, trace: []
    };
    var res = postResult('svc_triagepilot', gs.getProperty('x_tp.test_integration_password'), body);
    assertEqual({ name: 'callback accepted', shouldbe: 200, value: res.getStatusCode() });

    var after = new GlideRecord('x_tp_ai_triage_run');
    after.get(runId);
    assertEqual({ name: 'run status updated', shouldbe: 'completed', value: after.getValue('status') });
    assertEqual({ name: 'suggested category stored', shouldbe: 'Storage', value: after.getValue('suggested_category') });
    assertEqual({ name: 'latency stored', shouldbe: '1200', value: String(after.getValue('latency_ms')) });

    var bad = postResult('svc_triagepilot', gs.getProperty('x_tp.test_integration_password'), { run_sys_id: runId, status: 'completed', category: 'Not a category', confidence: 0.9 });
    assertEqual({ name: 'unknown category is rejected', shouldbe: 400, value: bad.getStatusCode() });

    var again = postResult('svc_triagepilot', gs.getProperty('x_tp.test_integration_password'), body);
    assertEqual({ name: 'a repeated callback is ignored', shouldbe: 200, value: again.getStatusCode() });
    return true;
})(outputs, steps, params, stepResult, assertEqual);
