var TriageClient = Class.create();
TriageClient.prototype = {
    RUN_TABLE: 'x_tp_ai_triage_run',

    initialize: function () {
        this.pii = new TriagePII();
    },

    /**
     * Creates a queued run for the incident and hands it to the agent service.
     * The run key (sys_id + mod count) makes a repeated trigger a no-op.
     */
    queueRun: function (incGr) {
        var modCount = parseInt(incGr.getValue('sys_mod_count'), 10) || 0;
        var runKey = incGr.getUniqueValue() + ':' + modCount;

        var dup = new GlideRecord(this.RUN_TABLE);
        dup.addQuery('run_key', runKey);
        dup.query();
        if (dup.next()) {
            return dup.getUniqueValue();
        }

        var run = new GlideRecord(this.RUN_TABLE);
        run.initialize();
        run.setValue('incident', incGr.getUniqueValue());
        run.setValue('run_key', runKey);
        run.setValue('mod_count', modCount);
        run.setValue('status', 'queued');
        run.setValue('outcome', 'pending');
        var runId = run.insert();

        var payload = {
            incident_sys_id: incGr.getUniqueValue(),
            number: incGr.getValue('number'),
            short_description: this.pii.scrub(incGr.getValue('short_description')),
            description: this.pii.scrub(incGr.getValue('description')),
            priority: parseInt(incGr.getValue('priority'), 10) || 4,
            mod_count: modCount,
            run_sys_id: runId
        };

        var error = this._post('/v1/triage', payload);
        if (error) {
            var failed = new GlideRecord(this.RUN_TABLE);
            if (failed.get(runId)) {
                failed.setValue('status', 'failed');
                failed.setValue('error_message', error);
                failed.update();
            }
        }
        return runId;
    },

    rerun: function (incGr) {
        incGr.work_notes = 'AI triage re-run requested.';
        incGr.update();
        var fresh = new GlideRecord('incident');
        fresh.get(incGr.getUniqueValue());
        return this.queueRun(fresh);
    },

    requestArticle: function (incGr) {
        var body = {
            incident_sys_id: incGr.getUniqueValue(),
            number: incGr.getValue('number'),
            short_description: this.pii.scrub(incGr.getValue('short_description')),
            description: this.pii.scrub(incGr.getValue('description')),
            category: incGr.getValue('category') || '',
            close_notes: this.pii.scrub(incGr.getValue('close_notes'))
        };
        return this._post('/v1/knowledge/draft', body);
    },

    /** Returns an error message, or an empty string when the agent accepted the request. */
    _post: function (path, body) {
        var base = gs.getProperty('x_tp.agent_url', '');
        if (!base) {
            return 'x_tp.agent_url is not set';
        }
        try {
            var msg = new sn_ws.RESTMessageV2();
            msg.setEndpoint(base.replace(/\/+$/, '') + path);
            msg.setHttpMethod('POST');
            msg.setRequestHeader('Content-Type', 'application/json');
            msg.setRequestHeader('Authorization', 'Bearer ' + gs.getProperty('x_tp.agent_token', ''));
            msg.setHttpTimeout(10000);
            msg.setRequestBody(JSON.stringify(body));
            var res = msg.execute();
            var code = res.getStatusCode();
            if (code !== 202) {
                return 'agent answered HTTP ' + code;
            }
            return '';
        } catch (e) {
            return 'agent unreachable: ' + e.message;
        }
    },

    type: 'TriageClient'
};
