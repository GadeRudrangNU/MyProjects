(function (outputs, steps, params, stepResult, assertEqual) {
    function call(method, path, user, password, body) {
        var msg = new sn_ws.RESTMessageV2();
        msg.setEndpoint(gs.getProperty('glide.servlet.uri') + path);
        msg.setHttpMethod(method);
        msg.setBasicAuth(user, password);
        msg.setRequestHeader('Content-Type', 'application/json');
        if (body) {
            msg.setRequestBody(JSON.stringify(body));
        }
        return msg.execute().getStatusCode();
    }

    var payload = { run_sys_id: 'does-not-matter', status: 'completed', category: 'Hardware', confidence: 0.9 };
    assertEqual({ name: 'employee cannot post a triage result', shouldbe: 403, value: call('POST', 'api/x_tp/triage/result', 'emp.beth', gs.getProperty('x_tp.test_employee_password'), payload) });
    assertEqual({ name: 'employee cannot read triage runs', shouldbe: 403, value: call('GET', 'api/now/table/x_tp_ai_triage_run', 'emp.beth', gs.getProperty('x_tp.test_employee_password')) });
    assertEqual({ name: 'service desk agent cannot post a triage result', shouldbe: 403, value: call('POST', 'api/x_tp/triage/result', 'desk.agent', gs.getProperty('x_tp.test_agent_password'), payload) });
    assertEqual({ name: 'wrong password is refused', shouldbe: 401, value: call('POST', 'api/x_tp/triage/result', 'svc_triagepilot', 'nope', payload) });
    assertEqual({ name: 'integration user can reach the endpoint', shouldbe: 404, value: call('POST', 'api/x_tp/triage/result', 'svc_triagepilot', gs.getProperty('x_tp.test_integration_password'), payload) });
    return true;
})(outputs, steps, params, stepResult, assertEqual);
