var TriageMetrics = Class.create();
TriageMetrics.prototype = {
    initialize: function () {},

    summary: function () {
        var runs = [];
        var gr = new GlideRecord('x_tp_ai_triage_run');
        gr.query();
        while (gr.next()) {
            runs.push({
                status: gr.getValue('status'),
                outcome: gr.getValue('outcome'),
                path: gr.getValue('path'),
                category: gr.getValue('suggested_category'),
                latency: parseInt(gr.getValue('latency_ms'), 10) || 0,
                incident: gr.getValue('incident')
            });
        }

        var answered = 0, autoRouted = 0, autoChecked = 0, autoCorrect = 0, fast = 0, llm = 0, failed = 0;
        var latencies = [];
        var byCategory = {};
        for (var i = 0; i < runs.length; i++) {
            var r = runs[i];
            if (r.status === 'failed') {
                failed++;
                continue;
            }
            if (r.status !== 'completed' && r.status !== 'needs_review') {
                continue;
            }
            answered++;
            latencies.push(r.latency);
            if (r.path === 'fast') { fast++; } else if (r.path === 'llm') { llm++; }
            var final = this._finalCategory(r.incident);
            if (final) {
                var c = byCategory[r.category] || (byCategory[r.category] = { total: 0, correct: 0 });
                c.total++;
                if (final === r.category) { c.correct++; }
            }
            if (r.outcome === 'auto_routed') {
                autoRouted++;
                if (final) {
                    autoChecked++;
                    if (final === r.category) { autoCorrect++; }
                }
            }
        }

        var accepted = this._count('x_tp_ai_feedback', 'decision', 'accepted');
        var rejected = this._count('x_tp_ai_feedback', 'decision', 'rejected');
        var accuracyByCategory = [];
        for (var cat in byCategory) {
            accuracyByCategory.push({ category: cat, total: byCategory[cat].total, accuracy: this._pct(byCategory[cat].correct, byCategory[cat].total) });
        }
        accuracyByCategory.sort(function (a, b) { return a.category < b.category ? -1 : 1; });

        return {
            total_runs: runs.length,
            answered: answered,
            failed_runs: failed,
            auto_routed: autoRouted,
            auto_routed_pct: this._pct(autoRouted, answered),
            routing_accuracy_pct: this._pct(autoCorrect, autoChecked),
            acceptance_rate_pct: this._pct(accepted, accepted + rejected),
            accepted: accepted,
            rejected: rejected,
            fast_path_pct: this._pct(fast, fast + llm),
            llm_path_pct: this._pct(llm, fast + llm),
            p95_latency_ms: this._p95(latencies),
            accuracy_by_category: accuracyByCategory,
            articles_drafted: this._count('x_tp_knowledge_draft', 'status', 'drafted'),
            articles_skipped: this._count('x_tp_knowledge_draft', 'status', 'skipped_duplicate')
        };
    },

    _finalCategory: function (incidentId) {
        var inc = new GlideRecord('incident');
        if (inc.get(incidentId)) {
            return inc.getValue('u_final_category') || '';
        }
        return '';
    },

    _count: function (table, field, value) {
        var ga = new GlideAggregate(table);
        ga.addQuery(field, value);
        ga.addAggregate('COUNT');
        ga.query();
        return ga.next() ? parseInt(ga.getAggregate('COUNT'), 10) : 0;
    },

    _pct: function (num, den) {
        return den ? Math.round((num / den) * 1000) / 10 : null;
    },

    _p95: function (values) {
        if (!values.length) {
            return null;
        }
        values.sort(function (a, b) { return a - b; });
        return values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)];
    },

    type: 'TriageMetrics'
};
