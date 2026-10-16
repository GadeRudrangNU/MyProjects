(function (outputs, steps, params, stepResult, assertEqual) {
    function makeRun(priority) {
        var inc = new GlideRecord('incident');
        inc.initialize();
        inc.setValue('short_description', 'ATF: routing test');
        inc.setValue('u_imported', 'true');
        inc.setValue('priority', String(priority));
        var incId = inc.insert();
        var run = new GlideRecord('x_tp_ai_triage_run');
        run.initialize();
        run.setValue('incident', incId);
        run.setValue('run_key', incId + ':0');
        run.setValue('status', 'queued');
        run.setValue('outcome', 'pending');
        return { incident: incId, run: run.insert() };
    }

    function finish(ids, confidence, path) {
        var msg = new sn_ws.RESTMessageV2();
        msg.setEndpoint(gs.getProperty('glide.servlet.uri') + 'api/x_tp/triage/result');
        msg.setHttpMethod('POST');
        msg.setBasicAuth('svc_triagepilot', gs.getProperty('x_tp.test_integration_password'));
        msg.setRequestHeader('Content-Type', 'application/json');
        msg.setRequestBody(JSON.stringify({
            run_sys_id: ids.run, incident_sys_id: ids.incident, status: 'completed', category: 'Hardware',
            assignment_group: 'TP Hardware Support', confidence: confidence, path: path, reasoning: 'ATF',
            reply_draft: 'Please bring the laptop to the desk.', cited_articles: ['KB0010011'], latency_ms: 900, attempts: 1, trace: []
        }));
        msg.execute();
        gs.sleep(300);
    }

    function approvals(incId) {
        var ap = new GlideRecord('sysapproval_approver');
        ap.addQuery('document_id', incId);
        ap.query();
        return ap.getRowCount();
    }

    var low = makeRun(3);
    finish(low, 0.55, 'llm');
    var lowInc = new GlideRecord('incident');
    lowInc.get(low.incident);
    assertEqual({ name: 'low confidence creates one approval', shouldbe: 1, value: approvals(low.incident) });
    assertEqual({ name: 'low confidence leaves the category alone', shouldbe: '', value: String(lowInc.getValue('category') || '') });
    assertEqual({ name: 'suggestion is waiting for a person', shouldbe: 'pending', value: lowInc.getValue('u_ai_suggestion_state') });

    var urgent = makeRun(1);
    finish(urgent, 0.97, 'fast');
    assertEqual({ name: 'priority 1 always needs approval', shouldbe: 1, value: approvals(urgent.incident) });

    var high = makeRun(3);
    finish(high, 0.93, 'fast');
    var highInc = new GlideRecord('incident');
    highInc.get(high.incident);
    assertEqual({ name: 'high confidence sets the category', shouldbe: 'Hardware', value: highInc.getValue('category') });
    assertEqual({ name: 'high confidence sets the group', shouldbe: 'TP Hardware Support', value: highInc.getDisplayValue('assignment_group') });
    assertEqual({ name: 'high confidence needs no approval', shouldbe: 0, value: approvals(high.incident) });
    return true;
})(outputs, steps, params, stepResult, assertEqual);
