/*
 * UI action: Accept AI suggestion   Table: incident   Client: true   Onclick: acceptSuggestion()
 * Condition: current.u_ai_suggestion_state == 'pending'
 */
function acceptSuggestion() {
    var ga = new GlideAjax('x_tp.TriageAjax');
    ga.addParam('sysparm_name', 'accept');
    ga.addParam('sysparm_incident', g_form.getUniqueValue());
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
