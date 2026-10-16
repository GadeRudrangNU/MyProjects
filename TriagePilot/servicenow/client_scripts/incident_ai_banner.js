/*
 * Client script: TriagePilot - show the AI suggestion banner
 * Table: incident   Type: onLoad
 */
function onLoad() {
    var state = g_form.getValue('u_ai_suggestion_state');
    if (state === 'pending') {
        var ga = new GlideAjax('x_tp.TriageAjax');
        ga.addParam('sysparm_name', 'summary');
        ga.addParam('sysparm_incident', g_form.getUniqueValue());
        ga.getXMLAnswer(function (answer) {
            var s = JSON.parse(answer || '{}');
            if (s.category) {
                g_form.addInfoMessage('AI suggestion waiting for your decision: ' + s.category + ' to ' + s.group + ' (' + s.confidence + '% sure). Use Accept, Reject or Re-run triage.');
            }
        });
        g_form.setVisible('u_reject_reason', true);
    } else {
        g_form.setVisible('u_reject_reason', false);
        if (state === 'applied_auto') {
            g_form.addInfoMessage('This incident was routed automatically by AI triage. See the work notes for the reasoning.');
        }
    }
}
