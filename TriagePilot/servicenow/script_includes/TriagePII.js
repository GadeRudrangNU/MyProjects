var TriagePII = Class.create();
TriagePII.prototype = {
    initialize: function () {},

    scrub: function (text) {
        if (!text) {
            return '';
        }
        var out = String(text);
        out = out.replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, '[EMAIL]');
        out = out.replace(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, '[IP]');
        out = out.replace(/(^|[^\w.])((?:\+?\d{1,3}[\s.\-]?)?(?:\(\d{3}\)|\d{3})[\s.\-]?\d{3}[\s.\-]?\d{4})(?!\w)/g, '$1[PHONE]');
        return out;
    },

    type: 'TriagePII'
};
