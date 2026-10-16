var TriageFeedback = Class.create();
TriageFeedback.prototype = {
    initialize: function () {
        this.router = new TriageRouter();
    },

    latestRun: function (incidentId) {
        var run = new GlideRecord('x_tp_ai_triage_run');
        run.addQuery('incident', incidentId);
        run.orderByDesc('sys_created_on');
        run.setLimit(1);
        run.query();
        return run.next() ? run : null;
    },

    accept: function (incidentId, fromApproval) {
        var inc = new GlideRecord('incident');
        var run = this.latestRun(incidentId);
        if (!inc.get(incidentId) || !run) {
            return { ok: false, message: 'No AI suggestion on this incident.' };
        }
        if (inc.getValue('u_ai_suggestion_state') !== 'pending') {
            return { ok: false, message: 'There is no pending suggestion.' };
        }
        this.router.applySuggestion(inc, run, 'accepted by ' + gs.getUserDisplayName());
        inc.setValue('u_ai_suggestion_state', 'accepted');
        inc.update();
        run.setValue('outcome', 'accepted');
        run.update();
        this._log(run, incidentId, 'accepted', '');
        if (!fromApproval) {
            this._closeApproval(incidentId, 'approved');
        }
        return { ok: true, message: 'Suggestion applied.' };
    },

    reject: function (incidentId, reason, fromApproval) {
        if (!reason || !String(reason).trim()) {
            return { ok: false, message: 'A reason is required to reject the suggestion.' };
        }
        var inc = new GlideRecord('incident');
        var run = this.latestRun(incidentId);
        if (!inc.get(incidentId) || !run) {
            return { ok: false, message: 'No AI suggestion on this incident.' };
        }
        if (inc.getValue('u_ai_suggestion_state') !== 'pending') {
            return { ok: false, message: 'There is no pending suggestion.' };
        }
        inc.setValue('u_ai_suggestion_state', 'rejected');
        inc.work_notes = 'AI suggestion rejected by ' + gs.getUserDisplayName() + ': ' + reason;
        inc.update();
        run.setValue('outcome', 'rejected');
        run.update();
        this._log(run, incidentId, 'rejected', reason);
        if (!fromApproval) {
            this._closeApproval(incidentId, 'rejected');
        }
        return { ok: true, message: 'Suggestion rejected.' };
    },

    rerun: function (incidentId) {
        var inc = new GlideRecord('incident');
        if (!inc.get(incidentId)) {
            return { ok: false, message: 'Incident not found.' };
        }
        var run = this.latestRun(incidentId);
        if (run) {
            this._log(run, incidentId, 'rerun', '');
        }
        inc.setValue('u_ai_suggestion_state', 'none');
        inc.update();
        new TriageClient().rerun(inc);
        return { ok: true, message: 'Triage queued again.' };
    },

    _log: function (run, incidentId, decision, reason) {
        var fb = new GlideRecord('x_tp_ai_feedback');
        fb.initialize();
        fb.setValue('run', run.getUniqueValue());
        fb.setValue('incident', incidentId);
        fb.setValue('decision', decision);
        fb.setValue('reason', reason);
        fb.setValue('actor', gs.getUserID());
        fb.insert();
    },

    _closeApproval: function (incidentId, state) {
        var ap = new GlideRecord('sysapproval_approver');
        ap.addQuery('document_id', incidentId);
        ap.addQuery('state', 'requested');
        ap.query();
        while (ap.next()) {
            ap.setValue('state', state);
            ap.setValue('u_handled_by_feedback', 'true');
            ap.update();
        }
    },

    type: 'TriageFeedback'
};
