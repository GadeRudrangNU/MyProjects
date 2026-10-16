(function (outputs, steps, params, stepResult, assertEqual) {
    var inc = new GlideRecord('incident');
    inc.initialize();
    inc.setValue('short_description', 'ATF: duplicate trigger');
    inc.setValue('u_imported', 'true');
    inc.setValue('priority', '4');
    var incId = inc.insert();

    var fresh = new GlideRecord('incident');
    fresh.get(incId);
    var client = new TriageClient();
    var first = client.queueRun(fresh);
    var second = client.queueRun(fresh);
    assertEqual({ name: 'same incident revision returns the same run', shouldbe: first, value: second });

    var runs = new GlideRecord('x_tp_ai_triage_run');
    runs.addQuery('incident', incId);
    runs.query();
    assertEqual({ name: 'only one run exists', shouldbe: 1, value: runs.getRowCount() });
    return true;
})(outputs, steps, params, stepResult, assertEqual);
