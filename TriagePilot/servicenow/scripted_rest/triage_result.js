/*
 * Scripted REST API: TriagePilot   Base path: /api/x_tp/triage
 * Resource: POST /result   Requires authentication, ACL role x_tp_integration
 */
(function process(request, response) {
    var CATEGORIES = ['Access', 'Administrative rights', 'HR Support', 'Hardware', 'Internal Project', 'Miscellaneous', 'Purchase', 'Storage'];
    var STATUSES = ['completed', 'needs_review', 'failed'];
    var body = request.body.data;

    function reject(code, message) {
        response.setStatus(code);
        response.setBody({ error: { message: message } });
    }

    if (!body || !body.run_sys_id) {
        return reject(400, 'run_sys_id is required');
    }
    if (STATUSES.indexOf(body.status) === -1) {
        return reject(400, 'status must be one of ' + STATUSES.join(', '));
    }
    var confidence = Number(body.confidence);
    if (isNaN(confidence) || confidence < 0 || confidence > 1) {
        return reject(400, 'confidence must be between 0 and 1');
    }
    if (body.status !== 'failed' && CATEGORIES.indexOf(body.category) === -1) {
        return reject(400, 'category is not one of the known categories');
    }

    var run = new GlideRecord('x_tp_ai_triage_run');
    if (!run.get(body.run_sys_id)) {
        return reject(404, 'unknown run');
    }
    var existing = run.getValue('status');
    if (existing === 'completed' || existing === 'needs_review' || existing === 'failed') {
        response.setStatus(200);
        return response.setBody({ result: { ignored: true, reason: 'run already finished' } });
    }

    var groupId = '';
    if (body.assignment_group) {
        var g = new GlideRecord('sys_user_group');
        g.addQuery('name', body.assignment_group);
        g.query();
        if (g.next()) {
            groupId = g.getUniqueValue();
        } else {
            return reject(400, 'assignment group does not exist');
        }
    }

    if (body.status !== 'failed') {
        run.setValue('suggested_category', body.category);
        if (groupId) {
            run.setValue('suggested_group', groupId);
        }
    }
    run.setValue('confidence', confidence);
    run.setValue('path', body.path || '');
    run.setValue('reasoning', body.reasoning || '');
    run.setValue('reply_draft', body.reply_draft || '');
    run.setValue('cited_articles', (body.cited_articles || []).join(','));
    run.setValue('similar_incidents', (body.similar_incidents || []).join(','));
    run.setValue('retrieved_articles', (body.retrieved_articles || []).join(','));
    run.setValue('latency_ms', parseInt(body.latency_ms, 10) || 0);
    run.setValue('attempts', parseInt(body.attempts, 10) || 1);
    run.setValue('trace', JSON.stringify(body.trace || []));
    run.setValue('error_message', (body.errors || []).join('; '));
    run.setValue('status', body.status);
    run.update();

    response.setStatus(200);
    response.setBody({ result: { ok: true, run: run.getUniqueValue() } });
})(request, response);
