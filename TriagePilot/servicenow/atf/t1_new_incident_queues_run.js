(function (outputs, steps, params, stepResult, assertEqual) {
    var inc = new GlideRecord('incident');
    inc.initialize();
    inc.setValue('short_description', 'ATF: cannot sign in to the VPN');
    inc.setValue('description', 'Password is rejected since this morning. Call me on 617-555-0142 or write to atf.user@example.com');
    inc.setValue('priority', '4');
    var id = inc.insert();

    var run = null;
    for (var i = 0; i < 20 && !run; i++) {
        gs.sleep(250);
        var gr = new GlideRecord('x_tp_ai_triage_run');
        gr.addQuery('incident', id);
        gr.query();
        if (gr.next()) {
            run = gr;
        }
    }

    assertEqual({ name: 'a triage run exists for the new incident', shouldbe: true, value: run !== null });
    if (run) {
        assertEqual({ name: 'run key is incident id and mod count', shouldbe: true, value: /^[0-9a-f]{32}:\d+$/.test(run.getValue('run_key')) });
        assertEqual({ name: 'run started as queued, running or already finished', shouldbe: true, value: ['queued', 'running', 'completed', 'needs_review', 'failed'].indexOf(run.getValue('status')) !== -1 });
    }
    outputs.incident = id;
    stepResult.setOutputMessage('Checked incident ' + id);
    return true;
})(outputs, steps, params, stepResult, assertEqual);
