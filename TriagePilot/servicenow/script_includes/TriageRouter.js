var TriageRouter = Class.create();
TriageRouter.prototype = {
    initialize: function () {},

    /**
     * Called by the "Route triage result" flow when a run changes status.
     * Applies the suggestion on its own when confidence is high and the incident is not urgent,
     * otherwise asks the Service Desk to approve it.
     */
    route: function (runGr) {
        var status = runGr.getValue('status');
        if (status !== 'completed' && status !== 'needs_review' && status !== 'failed') {
            return;
        }
        if (runGr.getValue('outcome') !== 'pending') {
            return;
        }

        var inc = new GlideRecord('incident');
        if (!inc.get(runGr.getValue('incident'))) {
            return;
        }

        if (status === 'failed') {
            runGr.setValue('outcome', 'failed');
            runGr.update();
            inc.work_notes = 'AI triage failed (' + runGr.getValue('error_message') + '). Handle this ticket the normal way.';
            inc.update();
            return;
        }

        var threshold = parseFloat(gs.getProperty('x_tp.auto_route_threshold', '0.85'));
        var priority = parseInt(inc.getValue('priority'), 10) || 4;
        var confidence = parseFloat(runGr.getValue('confidence')) || 0;
        var confident = status === 'completed' && confidence >= threshold && priority > 2;

        if (confident) {
            this.applySuggestion(inc, runGr, 'auto-routed');
            runGr.setValue('outcome', 'auto_routed');
            runGr.update();
            return;
        }

        var approvalId = this._requestApproval(inc, runGr, status, confidence, priority, threshold);
        runGr.setValue('outcome', 'approval_requested');
        runGr.setValue('approval', approvalId);
        runGr.update();
        inc.setValue('u_ai_suggestion_state', 'pending');
        inc.update();
    },

    applySuggestion: function (inc, runGr, how) {
        var group = runGr.getValue('suggested_group');
        inc.setValue('category', runGr.getValue('suggested_category'));
        if (group) {
            inc.setValue('assignment_group', group);
        }
        inc.setValue('u_ai_suggestion_state', how === 'auto-routed' ? 'applied_auto' : 'applied');
        inc.work_notes = this._note(runGr, how);
        inc.update();
    },

    _note: function (runGr, how) {
        var lines = [];
        lines.push('AI triage ' + how + ': ' + runGr.getValue('suggested_category') + ' -> ' + runGr.getDisplayValue('suggested_group'));
        lines.push('Confidence ' + (parseFloat(runGr.getValue('confidence')) * 100).toFixed(0) + '% via the ' + runGr.getValue('path') + ' path.');
        lines.push('Why: ' + runGr.getValue('reasoning'));
        var arts = this._articleLinks(runGr.getValue('cited_articles'));
        if (arts) {
            lines.push('Articles: ' + arts);
        }
        var similar = runGr.getValue('similar_incidents');
        if (similar) {
            lines.push('Similar resolved tickets: ' + similar);
        }
        lines.push('Draft reply: ' + runGr.getValue('reply_draft'));
        return lines.join('\n');
    },

    _articleLinks: function (csv) {
        if (!csv) {
            return '';
        }
        var out = [];
        var ids = csv.split(',');
        for (var i = 0; i < ids.length; i++) {
            var kb = new GlideRecord('kb_knowledge');
            kb.addQuery('number', ids[i].trim());
            kb.query();
            if (kb.next()) {
                out.push('[code]<a href="/kb_view.do?sysparm_article=' + kb.getValue('number') + '">' + kb.getValue('number') + '</a>[/code] ' + kb.getValue('short_description'));
            }
        }
        return out.join('; ');
    },

    _groupId: function (name) {
        var g = new GlideRecord('sys_user_group');
        g.addQuery('name', name);
        g.query();
        return g.next() ? g.getUniqueValue() : '';
    },

    _requestApproval: function (inc, runGr, status, confidence, priority, threshold) {
        var why = [];
        if (status === 'needs_review') {
            why.push('the agent could not produce a valid answer');
        }
        if (confidence < threshold) {
            why.push('confidence ' + (confidence * 100).toFixed(0) + '% is below ' + (threshold * 100).toFixed(0) + '%');
        }
        if (priority <= 2) {
            why.push('priority ' + priority + ' needs a person');
        }
        var ap = new GlideRecord('sysapproval_approver');
        ap.initialize();
        ap.setValue('source_table', 'incident');
        ap.setValue('document_id', inc.getUniqueValue());
        ap.setValue('group', this._groupId(gs.getProperty('x_tp.approval_group', 'TP Service Desk')));
        ap.setValue('state', 'requested');
        ap.setValue('comments', 'Suggested: ' + runGr.getValue('suggested_category') + ' (' + runGr.getDisplayValue('suggested_group') + '). Needs approval because ' + why.join(' and ') + '.');
        return ap.insert();
    },

    type: 'TriageRouter'
};
