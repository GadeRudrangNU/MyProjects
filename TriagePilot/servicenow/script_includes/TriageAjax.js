var TriageAjax = Class.create();
TriageAjax.prototype = Object.extendsObject(AbstractAjaxProcessor, {
    summary: function () {
        var run = new TriageFeedback().latestRun(this.getParameter('sysparm_incident'));
        if (!run) {
            return '{}';
        }
        return JSON.stringify({
            category: run.getValue('suggested_category'),
            group: run.getDisplayValue('suggested_group'),
            confidence: Math.round(parseFloat(run.getValue('confidence')) * 100)
        });
    },

    accept: function () {
        return JSON.stringify(new TriageFeedback().accept(this.getParameter('sysparm_incident'), false));
    },

    reject: function () {
        return JSON.stringify(new TriageFeedback().reject(this.getParameter('sysparm_incident'), this.getParameter('sysparm_reason'), false));
    },

    rerun: function () {
        return JSON.stringify(new TriageFeedback().rerun(this.getParameter('sysparm_incident')));
    },

    type: 'TriageAjax'
});
