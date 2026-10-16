/*
 * UI action: Reject AI suggestion   Table: incident   Client: true   Onclick: rejectSuggestion()
 * Condition: current.u_ai_suggestion_state == 'pending'
 */
function rejectSuggestion() {
    var reason = g_form.getValue('u_reject_reason');
    if (!reason || !reason.trim()) {
        g_form.showFieldMsg('u_reject_reason', 'Say why the suggestion is wrong.', 'error');
        return;
    }
    var ga = new GlideAjax('x_tp.TriageAjax');
    ga.addParam('sysparm_name', 'reject');
    ga.addParam('sysparm_incident', g_form.getUniqueValue());
    ga.addParam('sysparm_reason', reason);
    ga.getXMLAnswer(function (answer) {
        var r = JSON.parse(answer);
        if (r.ok) {
            g_form.addInfoMessage(r.message);
            gsftSubmit(null, g_form.getFormElement(), 'reload');
        } else {
            g_form.addErrorMessage(r.message);
        }
    });
}
