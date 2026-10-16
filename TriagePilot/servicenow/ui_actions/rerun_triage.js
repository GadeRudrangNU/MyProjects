/*
 * UI action: Re-run triage   Table: incident   Client: true   Onclick: rerunTriage()
 * Condition: current.u_imported == false
 */
function rerunTriage() {
    var ga = new GlideAjax('x_tp.TriageAjax');
    ga.addParam('sysparm_name', 'rerun');
    ga.addParam('sysparm_incident', g_form.getUniqueValue());
    ga.getXMLAnswer(function (answer) {
        var r = JSON.parse(answer);
        g_form.addInfoMessage(r.message);
        gsftSubmit(null, g_form.getFormElement(), 'reload');
    });
}
