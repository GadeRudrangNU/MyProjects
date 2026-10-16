/*
 * Scripted REST API: TriagePilot   Resource: POST /api/x_tp/triage/knowledge_result
 * Records what the knowledge agent did for a resolved incident.
 */
(function process(request, response) {
    var body = request.body.data;
    if (!body || !body.incident_sys_id || !body.status) {
        response.setStatus(400);
        return response.setBody({ error: { message: 'incident_sys_id and status are required' } });
    }
    var rec = new GlideRecord('x_tp_knowledge_draft');
    rec.initialize();
    rec.setValue('incident', body.incident_sys_id);
    rec.setValue('status', body.status);
    rec.setValue('reason', body.reason || '');
    rec.setValue('article_number', body.article_number || '');
    rec.setValue('nearest_article', body.nearest || '');
    rec.setValue('similarity', Number(body.similarity) || 0);
    var id = rec.insert();
    response.setStatus(200);
    response.setBody({ result: { ok: true, id: id } });
})(request, response);
