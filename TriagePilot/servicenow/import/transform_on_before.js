(function runTransformScript(source, map, log, target /*undefined onStart*/) {
    var GROUPS = {
        'Access': 'TP Access Management',
        'Administrative rights': 'TP Admin Rights',
        'HR Support': 'TP HR Support',
        'Hardware': 'TP Hardware Support',
        'Internal Project': 'TP Project Desk',
        'Miscellaneous': 'TP Service Desk Triage',
        'Purchase': 'TP Procurement',
        'Storage': 'TP Storage Team'
    };

    var doc = String(source.document);
    var words = doc.split(/\s+/);
    target.short_description = words.slice(0, 10).join(' ').substring(0, 80);

    var groupName = GROUPS[String(source.topic_group)];
    if (!groupName) {
        log.warn('Unknown topic group ' + source.topic_group + ' for ' + source.ticket_id);
        ignore = true;
        return;
    }
    var g = new GlideRecord('sys_user_group');
    g.addQuery('name', groupName);
    g.query();
    if (g.next()) {
        target.assignment_group = g.getUniqueValue();
    }

    var n = String(source.ticket_id).replace(/\D/g, '');
    target.number = 'INC' + ('0000000' + n).slice(-7);
    target.state = 6;
    target.priority = 4;
    target.close_notes = 'Historical ticket loaded from the training corpus.';
    target.u_imported = true;
    target.u_final_category = source.topic_group;
    target.u_ai_suggestion_state = 'none';
})(source, map, log, target);
