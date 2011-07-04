// ==UserScript==
// @name           4watch
// @namespace      c355b9a1f72c6c23efc026e10810b0be
// @description    Spam blocker and report queuer for 4chan.  Reports spam to both 4chan and to the 4watch database, and hides posts and threads others have reported.
// @include        http://boards.4chan.org/*
// ==/UserScript==

// Thanks to Couchy for some needed fixes

(function() {

var VERSION = 18;
var ELEMENT_NODE = 1;
var TEXT_NODE = 3;
var DOCUMENT_POSITION_CONTAINS = 0x08;
var DOCUMENT_POSITION_CONTAINED_BY = 0x10;
var CACHE_SIZE = 1000;
var SERVER_ROOT = "http://4watch.org/"
var REPORT_DELAY = 10000;
var REPORT_WAIT = 60000;
var MSG_DELAY = 5000;
var BLUR_DELAY = 1000;
var UPDATE_DELAY = 60000;
var CAPTCHA_EXPIRE = 14400000; // 4 hours; exact value unknown
var R_URL = 0;
var R_BOARD = 1;
var R_POST = 2;
var R_TYPE = 3;
var R_TIME = 4;
var TYPES = ["phide", "quality", "OK", "bad", "vio", "spam", "illegal"];
var TYPE = {
    "phide":   {code: null, color: "gray",    report: false},
    "quality": {code: -1,   color: "gold",    report: false},
    "OK":      {code: 0,    color: "green",   report: false},
    "bad":     {code: 5,    color: "blue",    report: false},
    "vio":     {code: 2,    color: "red",     report: true},
    "spam":    {code: 3,    color: "fuchsia", report: true},
    "illegal": {code: 4,    color: "brown",   report: true}
};
var TYPES_HTML = '[\u202F'
    + '<a title="Hide for self only">x</a>\u202F'
    + '|\u202F'
    + '<a title="Quality post">\u25B2</a>\u202F'
    + '<a title="Normal post">O</a>\u202F'
    + '<a title="Bad post, but doesn\'t break any rules">\u25BC</a>\u202F'
    + '|\u202F'
    + '<a title="Rule violation">R</a>\u202F'
    + '<a title="Spam/advertising/flooding">S</a>\u202F'
    + '<a title="Illegal content">C</a>\u202F'
    + ']';
var DEFAULT_HIDE_TYPES = ["phide", "vio", "spam", "illegal"];
var PUBLIC_KEY = "6Ldp2bsSAAAAAAJ5uyx_lx34lJeEpTLVkP5k04qc";
var SHOW_REPORTS = 0;
var HIDE_REPORTS = 1;
var NO_REPORTS = 2;

function has(a, b) {
    return a.indexOf(b) != -1;
}

function $(id) {
    return document.getElementById(id);
}

if (Function.prototype.bind === undefined) Function.prototype.bind = function(thisArg) {
    var Target = this;
    var boundArgs = arguments;
    return function F() {
        var args = [];
        for (var i = 1; i < boundArgs.length; i++) args.push(boundArgs[i]);
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        return Target.apply(thisArg, args);
    }
}

if (Object.create === undefined) Object.create = function(O) {
    function F() {}
    F.prototype = O;
    return new F();
}

if (typeof(GM_getValue) == "undefined" || (GM_getValue.toString !== undefined && has(GM_getValue.toString(), "not supported"))) GM_getValue = function(key, def) {
    var val = localStorage.getItem(key);
    if (val == null) {
        return def;
    } else {
        try {
            return JSON.parse(val);
        } catch(e) {
            return def;
        }
    }
}

if (typeof(GM_setValue) == "undefined" || (GM_setValue.toString !== undefined && has(GM_setValue.toString(), "not supported"))) GM_setValue = function(key, val) {
    return localStorage.setItem(key, JSON.stringify(val));
}

var namespace = "c355b9a1f72c6c23efc026e10810b0be";

function window_eval(code) {
    if (window_eval.n === undefined) window_eval.n = 0;
    var id = namespace + "window_eval" + window_eval.n;
    window_eval.n++;
    var script = document.createElement("script");
    script.id = id;
    script.innerHTML = code + ';document.body.removeChild(document.getElementById("' + id + '"))';
    document.body.appendChild(script);
}

window_eval('\
   function userscript_callback(id) {\
        return function(data) {\
            if (userscript_callback.argn === undefined) userscript_callback.argn = 1;\
            var detail = 0;\
            if (data != null) {\
                detail = userscript_callback.argn;\
                var key = "' + namespace + '" + "callback_arg" + userscript_callback.argn;\
                userscript_callback.argn++;\
                sessionStorage.setItem(key, JSON.stringify(data));\
            }\
            var e = document.createEvent("UIEvents");\
            e.initUIEvent(id, false, false, window, detail);\
            document.body.dispatchEvent(e);\
        }\
    }\
');

function reg_callback(name, f) {
    if (reg_callback.n === undefined) reg_callback.n = 0;
    var id = namespace + "callback_f" + reg_callback.n;
    reg_callback.n++;
    function listener(e) {
        var data = null;
        if (e.detail != 0) {
            var key = namespace + "callback_arg" + e.detail;
            data = JSON.parse(sessionStorage.getItem(key));
            sessionStorage.removeItem(key);
        }
        f(data);
        document.body.removeEventListener(id, listener, false);
    }
    document.body.addEventListener(id, listener, false);
    window_eval(name + ' = userscript_callback("' + id + '")');
}

function try_GM_xmlhttpRequest(details) {
    if (try_GM_xmlhttpRequest.fails === undefined) {
        var onload = details.onload;
        var onerror = details.onerror;
        details.onload = function(response) {
            onload(response);
            try_GM_xmlhttpRequest.fails = false;
        }
        details.onerror = function() {
            onerror();
            try_GM_xmlhttpRequest.fails = true;
        }
    }
    if (try_GM_xmlhttpRequest.fails) {
        details.onerror();
    } else {
        try {
            GM_xmlhttpRequest(details);
        } catch(e) {
            details.onerror();
        }
    }
}

function load_data(url, handler) {
    if (has(url, "?")) {
        url += "&t=" + new Date().getTime();
    } else {
        url += "?t=" + new Date().getTime();
    }
    try_GM_xmlhttpRequest({
        method: "GET",
        url: url,
        onload: function(response) {
            var m = response.responseText.match(/data_loaded\((.*)\)/);
            if (m) handler(JSON.parse(m[1]));
        },
        onerror: function() {
            reg_callback("data_loaded", handler);
            var new_script = document.createElement("script");
            new_script.src = url;
            document.body.appendChild(new_script);
        }
    });
}

var board = location.href.replace(/\/+/g, "/").split("/")[2];
var posts = {};
var cache = {};
var page_thread = null;
var in_index = (location.href.replace(/\/+/g, "/").split("/").length == 4);
var in_thread = has(location.href, "/res/");
var hide_posts, hide_types, reports_mode, autorefresh, controls_position, message;
var mouse_down = false;
var window_id = GM_getValue("top_window_id", 0) + 1;
GM_setValue("top_window_id", window_id);
var controls, show_hide_switch, options_switch, hide_reports_switch, autorefresh_switch, position_switch;
var hide_types_switches = {};

function encode(fields) {
    var eqs = [];
    for (var f in fields) {
        var enc = encodeURIComponent(fields[f]).replace(/%20/g, "+");
        eqs.push(f + "=" + enc);
    }
    return eqs.join("&");
}

function Color_switch(content, colors, values, init_value, setter) {
    if (typeof(content) == "string") {
        this.element = document.createElement("span");
        this.element.innerHTML = content;
    } else {
        this.element = content;
    }
    this.colors = colors;
    this.values = values;
    this.links = document.evaluate("descendant-or-self::a", this.element, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    this.state = -1;
    for (var i = 0; i < this.links.snapshotLength; i++) {
        var link = this.links.snapshotItem(i);
        var this_switch = this;
        link.addEventListener("mouseover", this.set_color.bind(this, i), false);
        link.addEventListener("mouseout", function(e) {this_switch.set_color(this_switch.state);}, false);
        link.addEventListener("click", setter.bind(this, values[i]), false);
    }
    this.set(init_value);
}

Color_switch.prototype.set_color = function(new_state) {
    for (var i = 0; i < this.links.snapshotLength; i++) {
        this.links.snapshotItem(i).style.setProperty("color", (new_state == i) ? this.colors[i] : "inherit", "important");
    }
}

Color_switch.prototype.set = function(new_value) {
    var new_state = this.values.indexOf(new_value);
    this.set_color(new_state);
    for (var i = 0; i < this.links.snapshotLength; i++) {
        this.links.snapshotItem(i).style.setProperty("font-weight", (new_state == i) ? "bold" : "normal", "important");
    }
    this.state = new_state;
}

function set_hidden_between(node1, node2, hidden) {
    var n = node1;
    while (n != node2) {
        if (n.compareDocumentPosition(node2) & DOCUMENT_POSITION_CONTAINED_BY) {
            n = n.firstChild;
        } else {
            if (n.nodeType == TEXT_NODE && n.nodeValue != "") {
                var span = document.createElement("span");
                n.parentNode.insertBefore(span, n);
                span.appendChild(n);
                n = span;
            }
            if (n.nodeType == ELEMENT_NODE) {
                n.style.display = hidden ? "none" : "";
            }
            while (n.nextSibling == null) {
                n = n.parentNode;
            }
            n = n.nextSibling;
        }
    }
}

function Queue(name) {
    var this_queue = this;

    this.get = function() {
        var raw_queue = GM_getValue(name, "");
        if (raw_queue == "") {
            return [];
        } else {
            return raw_queue.split("\n");
        }
    }

    this.set = function(arr) {
        GM_setValue(name, arr.join("\n"));
    }

    this.pop = function() {
        var arr = this_queue.get();
        var x = arr.splice(0, 1)[0];
        this_queue.set(arr);
        return x;
    }

    this.requeue = function(entry) {
        var arr = this_queue.get();
        arr.splice(0, 0, entry);
        this_queue.set(arr);
    }

    this.push = function(entry) {
        var arr = this_queue.get();
        arr.push(entry);
        this_queue.set(arr);
    }

    this.size = function() {
        return this_queue.get().length;
    }
}
var report_queue = new Queue("report_queue");
var captcha_queue = new Queue("captcha_queue");

var last_switch = new Date().getTime();
function Post(qlink, thread) {
    // Read post number
    var qnums = qlink.href.match(/\d+/g);
    this.num = qnums[qnums.length - 1];
    this.thread = thread || this;
    this.op = (this == this.thread);
    if (in_thread) page_thread = this.thread;

    // Check for non-hideable posts (OP of thread, inline quotes, tooltips)
    if (this == page_thread) {
        this.hiding_qlink = null;
    } else {
        this.hiding_qlink = qlink;
        var table_count = 0;
        var node = qlink;
        while(node) {
            if (node.tagName == "TABLE") {
                table_count++;
            }
            if (table_count >= 2 || (node.style && node.style.position == "fixed")) {
                this.hiding_qlink = null;
                break;
            }
            node = node.parentNode;
        }
    }

    // Check for duplicates
    if (this.num in posts) {
        var p = posts[this.num];
        p.hiding_qlink = p.hiding_qlink || this.hiding_qlink;
        new Spam_switch(p, qlink);
        return p;
    }

    if (!this.op) this.thread.replies.push(this);
    this.replies = [];
    this.hidden = false;
    this.type = null;
    this.spam_switches = [];
    this.refresh_type();
    this.refresh_hidden();
    spam_switch_queue.push([this, qlink]);
    if (next_spam_switch_ID == null) next_spam_switch_ID = setTimeout(next_spam_switch, 0);
    posts[this.num] = this;
}

Post.prototype.refresh_hidden = function(force) {
    if (this.hiding_qlink == null) return;
    var hidden = (hide_posts && (has(hide_types, this.type) || in_index && has(hide_types, this.thread.type)));
    if (!force && this.hidden == hidden) return;
    this.hidden = hidden;
    if (this.op) {
        var node1 = document.evaluate("preceding::hr[1]", this.hiding_qlink, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        var node2 = document.evaluate("following::hr[1]", this.hiding_qlink, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        set_hidden_between(node1, node2, hidden);
        if (!hidden) {
            for (var i = 0; i < this.replies.length; i++) {
                this.replies[i].refresh_hidden(true);
            }
        }
    } else {
        var nodes = document.evaluate("ancestor::*[self::table or self::div]", this.hiding_qlink, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        nodes.snapshotItem(nodes.snapshotLength - 1).style.display = hidden ? "none" : "";
    }
}

Post.prototype.set_type = function(type) {
    if (type == this.type) return;
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i] != "OK") {
        var n = cache[TYPES[i]].indexOf(this.num);
        if (n != -1) cache[TYPES[i]].splice(n, 1);
        if (type == TYPES[i]) cache[TYPES[i]].push(this.num);
        if (cache[TYPES[i]].length > 2 * CACHE_SIZE) cache[TYPES[i]].splice(0, CACHE_SIZE);
        GM_setValue(TYPES[i] + "_cache_" + board, cache[TYPES[i]].join(" "));
    }
    this.type = type;
    for (var i = 0; i < this.spam_switches.length; i++) {
        this.spam_switches[i].set(type);
    }
    this.refresh_hidden();
    refresh_spam_count();
}

Post.prototype.refresh_type = function() {
    var type = "OK";
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i] != "OK") {
        if (has(cache[TYPES[i]], this.num)) {
            type = TYPES[i];
            break;
        }
    }
    if (type == this.type) return;
    this.type = type;
    for (var i = 0; i < this.spam_switches.length; i++) {
        this.spam_switches[i].set(type);
    }
}

Post.prototype.queue_report = function() {
    cancel_report(board, this.num);
    var report_url = document.getElementsByName("delform")[0].action + "?mode=report&no=" + this.num;
    report_queue.push(report_url + "\t" + board + "\t" + this.num + "\t" + this.type + "\t" + new Date().getTime());
    refresh_reports();
    if (report_queue.size() > captcha_queue.size()) {
        add_captcha();
    } else {
        wait_to_report();
    }
}

// Placement of spam switches is slow, so don't do them all at once
var next_spam_switch_ID = null;
var spam_switch_queue = [];
function next_spam_switch() {
    var t1 = new Date().getTime();
    clearTimeout(next_spam_switch_ID);
    var x = spam_switch_queue.splice(0, 1)[0];
    new Spam_switch(x[0], x[1]);
    if (spam_switch_queue.length > 0) {
        var t2 = new Date().getTime();
        next_spam_switch_ID = setTimeout(next_spam_switch, t2-t1+1);
    } else {
        next_spam_switch_ID = null;
    }
}

function Spam_switch(post, qlink) {
    this.post = post;
    this.qlink = qlink;

    // Remove duplicate spam switches
    var dups = document.evaluate('.//*[@name="spam_switch"]', qlink.parentNode, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (var i = 0; i < dups.snapshotLength; i++) {
        dups.snapshotItem(i).parentNode.removeChild(dups.snapshotItem(i));
    }

    // Call Color_switch constructor
    Color_switch.call(
        this,
        "&nbsp; " + TYPES_HTML,
        TYPES.map(function(t) {return TYPE[t].color}),
        TYPES,
        post.type,
        function(new_type, e) {
            if (!TYPE[new_type].report) {
                cancel_report(board, this.post.num);
            }
            load_cache();
            this.post.set_type(new_type);
            if (new_type != "phide") {
                this.flag(new_type, e);
            }
        }
    );

    // Add switch
    post.spam_switches.push(this);
    this.element.setAttribute("name", "spam_switch");
    qlink.parentNode.insertBefore(this.element, qlink.nextSibling);
}
Spam_switch.prototype = Object.create(Color_switch.prototype);

Spam_switch.prototype.flag = function(type, flag_e, captcha_data) {
    var this_switch = this;
    var data = {
        board: board,
        post: this.post.num,
        spam: TYPE[type].code,
        thread: this.post.thread.num,
        version: VERSION
    };
    if (type == "quality") {
        data["comment"] = this.comment();
    }
    data = encode(data);
    if (captcha_data) {
        data += "&" + captcha_data;
    }
    load_data(
        SERVER_ROOT + "flag.py?" + data,
        function(response) {
            if (response == "OK") {
                if (TYPE[this_switch.post.type].report && reports_mode != NO_REPORTS && !flag_e.ctrlKey) this_switch.post.queue_report();
            } else {
                this_switch.show_captcha(response, type, flag_e);
            }
        }
    );
}

Spam_switch.prototype.show_captcha = function(html, type, flag_e) {
    var this_switch = this;
    var old_cancel = $("captcha_cancel");
    if (old_cancel) {
        var e = document.createEvent("MouseEvent");
        e.initEvent("click", true, true);
        old_cancel.dispatchEvent(e);
    }
    setTimeout(function() {
        var captcha = document.createElement("span");
        captcha.innerHTML = html;
        captcha.id = "captcha_popup";

        captcha.style.position = "absolute";
        captcha.style.backgroundColor = "white";
        captcha.style.border = "1px solid black";
        function captcha_pos() {
            var max_left = document.body.offsetWidth - captcha.offsetWidth;
            captcha.style.left = Math.min(flag_e.pageX, max_left) + "px";
            captcha.style.top = flag_e.pageY + "px";
        }
        captcha_pos();
        captcha.addEventListener("DOMNodeInserted", captcha_pos, false);

        document.body.appendChild(captcha);

        if ($("captcha_cancel") == null) {
            captcha.innerHTML += '<center><input id="captcha_cancel" type="button" value="Cancel"></center>';
        }
        $("captcha_cancel").addEventListener("click", function(e) {
            setTimeout(function() {
                document.body.removeChild($("captcha_popup"));
            }, 0);
        }, false);

        var captcha_form = $("captcha_form");
        if (captcha_form) {
            $("captcha_form").addEventListener("submit", function(e) {
                setTimeout(function() {
                    var captcha_data = $("captcha_data");
                    if (captcha_data) {
                        this_switch.flag(type, flag_e, captcha_data.value);
                        document.body.removeChild($("captcha_popup"));
                    }
                }, 0);
            }, false);
        }
    }, 0);
}

Spam_switch.prototype.comment = function() {
    var parts = document.evaluate("following::blockquote[1]//node()[self::text() or self::br]", this.qlink, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    var s = "";
    for (var i = 0; i < parts.snapshotLength; i++) {
        if (parts.snapshotItem(i).nodeType == ELEMENT_NODE) {
            s += "\n";
        } else {
            s += parts.snapshotItem(i).textContent;
        }
    }
    return s;
}

function refresh_spam_count() {
    var thread_count = 0;
    var reply_count = 0;
    for (var num in posts) {
        if ((posts[num].hiding_qlink || posts[num] == page_thread) && has(hide_types, posts[num].type)) {
            if (posts[num].op) {
                thread_count++;
            } else {
                reply_count++;
            }
        }
    }
    $("spam_count").innerHTML = thread_count + (thread_count == 1 ? " thread, " : " threads, ") + reply_count + (reply_count == 1 ? " reply" : " replies");
}

function wait_to_report(next_report) {
    if (GM_getValue("current_window", -1) != window_id) return;

    var time = new Date().getTime();
    if (next_report === undefined) {
        next_report = parseInt(GM_getValue("next_report", time + ""));
    } else {
        GM_setValue("next_report", next_report + "");
    }
    if (next_report > time + REPORT_WAIT) {
        next_report = time + REPORT_WAIT;
        GM_setValue("next_report", next_report + "");
    }

    if (!(wait_to_report.timeoutID === undefined)) clearTimeout(wait_to_report.timeoutID);
    if (next_report > time) {
        wait_to_report.timeoutID = setTimeout(function() {wait_to_report();}, next_report - time);
        return;
    } else {
        wait_to_report.timeoutID = setTimeout(function() {wait_to_report();}, REPORT_WAIT);
    }

    if (reports_mode == NO_REPORTS) return;
    if (report_queue.size() == 0) return;
    if (captcha_queue.size() == 0) return;

    var delay_until = parseInt(report_queue.get()[0].split("\t")[R_TIME]) + REPORT_DELAY;
    if (delay_until > time) {
        wait_to_report(delay_until);
        return;
    }

    var entry = report_queue.pop().split("\t");
    var captcha = captcha_queue.pop();
    refresh_reports();

    report(entry[0], entry[1], entry[2], entry[3], captcha);
}

function report_fields(r_url, r_board, r_post, r_type, captcha) {
    var time = new Date().getTime();
    var captcha_fields = captcha.split(" ");
    if (!(parseInt(captcha_fields[2]) > time - CAPTCHA_EXPIRE)) {
        // CAPTCHA too old
        report_queue.requeue(r_url + "\t" + r_board + "\t" + r_post + "\t" + r_type + "\t" + time);
        refresh_reports();
        wait_to_report(time);
        return;
    }
    return {
        cat: r_type,
        recaptcha_challenge_field: unescape(captcha_fields[0]),
        recaptcha_response_field: unescape(captcha_fields[1]),
        board: r_board,
        no: r_post
    };
}

function report(r_url, r_board, r_post, r_type, captcha) {
    try_GM_xmlhttpRequest({
        method: "GET",
        url: r_url,
        onload: function(response) {
            var t = response.responseText;
            if (has(t, "You are reporting post")) {
                // Report window OK, submit report
                var fields = report_fields(r_url, r_board, r_post, r_type, captcha);
                GM_xmlhttpRequest({
                    method: "POST",
                    url: r_url,
                    headers: {"Content-type": "application/x-www-form-urlencoded"},
                    data: encode(fields),
                    onload: function(response2) {
                        // Response from submitting report
                        var t2 = response2.responseText;
                        var time2 = new Date().getTime();
                        show_msg(t2, r_board, r_post);
                        if (has(t2, "mistyped the verification")) {
                            report_queue.requeue(r_url + "\t" + r_board + "\t" + r_post + "\t" + r_type + "\t" + time2);
                            refresh_reports();
                            wait_to_report(time2);
                        } else if (has(t, "You have to wait a while") || has(t, "You've already reported enough posts")) {
                            report_queue.requeue(r_url + "\t" + r_board + "\t" + r_post + "\t" + r_type + "\t" + time2);
                            refresh_reports();
                            wait_to_report(time2 + REPORT_WAIT);
                        } else {
                            wait_to_report(time2 + REPORT_WAIT);
                        }
                    }
                });
            } else {
                // Error message when opening report window (haven't submitted yet)
                var time = new Date().getTime();
                show_msg(t, r_board, r_post);
                captcha_queue.requeue(captcha);
                if (has(t, "You have already reported this post") || has(t, "That post doesn't exist anymore.")) {
                    wait_to_report(time);
                } else if (has(t, "You have to wait a while") || has(t, "You've already reported enough posts")) {
                    report_queue.requeue(r_url + "\t" + r_board + "\t" + r_post + "\t" + r_type + "\t" + time);
                    wait_to_report(time + REPORT_WAIT);
                }
                refresh_reports();
            }
        },
        onerror: function() {
            var frame = document.createElement("iframe");
            frame.style.display = "none";
            frame.src = 'javascript:\'<form id=report action="' + r_url + '" method=POST>';
            var fields = report_fields(r_url, r_board, r_post, r_type, captcha);
            for (var name in fields) {
                frame.src += '<input name="' + html_escape(name) + '" value="' + html_escape(fields[name]) + '">';
            }
            frame.src += '</form><script>setTimeout(function(){document.getElementById("report").submit()}, 0)</script>\'';
            document.body.appendChild(frame);
        }
    });
}

function html_escape(s) {
    s2 = "";
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        if (has(" 0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", c)) {
            s2 += c;
        } else {
            s2 += "&#" + s.charCodeAt(i) + ";";
        }
    }
    return s2;
}

function show_msg(msg, board, post) {
    var msg2 = msg.match(/<h3>.*?<\/h3>/);
    if (!msg2) return;
    msg2 = msg2[0].replace(/<.*?>/g, "");
    var msg_line = document.createElement("div");
    msg_line.style.width = "160pt";
    msg_line.innerHTML = '/' + board + '/' + post + ': <span style="color: red;">' + msg2 + '</span><br>';
    $("msg_div").appendChild(msg_line);
    setTimeout(function() {
        if (msg_line.parentNode) msg_line.parentNode.removeChild(msg_line);
    }, MSG_DELAY);
}

function cancel_report(r_board, r_post) {
    var queue = report_queue.get();
    for (var i = 0; i < queue.length; i++) {
        var entry = queue[i].split("\t");
        if (entry[R_BOARD] == r_board && entry[R_POST] == r_post) {
            queue.splice(i, 1);
            i--;
        }
    }
    report_queue.set(queue);
    refresh_reports();
}

function refresh_reports() {
    while (captcha_queue.size() > 0) {
        var captcha_time = parseInt(captcha_queue.get()[0].split(" ")[2]);
        if (captcha_time > new Date().getTime() - CAPTCHA_EXPIRE) {
            break;
        } else {
            captcha_queue.pop();
        }
    }

    $("num_captchas").innerHTML = captcha_queue.size();
    if (reports_mode == SHOW_REPORTS) {
        $("msg_div").style.display = "block";
        $("reporting_div1").style.display = "block";
        $("reporting_div2").style.display = "block";
    } else if (reports_mode == HIDE_REPORTS) {
        $("msg_div").style.display = "none";
        $("reporting_div1").style.display = "none";
        $("reporting_div2").style.display = "none";
    } else {
        $("msg_div").style.display = "none";
        $("reporting_div1").style.display = "none";
        $("need_div").style.display = "none";
        $("reporting_div2").style.display = "none";
    }
    var needed = report_queue.size() - captcha_queue.size();
    if (needed > 0 && (reports_mode == SHOW_REPORTS || reports_mode == HIDE_REPORTS)) {
        $("need_div").style.display = "block";
        $("need_span").innerHTML = needed;
    } else {
        $("need_div").style.display = "none";
    }

    if (reports_mode == HIDE_REPORTS) return;
    var queue = report_queue.get();
    var ncaptchas = captcha_queue.size();
    if (queue.join("\n") == refresh_reports.queue_cache && ncaptchas == refresh_reports.captcha_cache) return;

    var reporting_div = [$("reporting_div1"), $("reporting_div2")];
    var rdih = ["", ""];
    for (var i = 0; i < queue.length; i++) {
        var entry = queue[i].split("\t");
        if (i < ncaptchas) {
            rdih[0] += '<span style="color: ' + TYPE[entry[R_TYPE]].color + '">[<a href=javascript:void(0)>x</a>] reporting ' + entry[R_POST] + ' on /' + entry[R_BOARD] + '/...</span><br>';
        } else {
            rdih[1] += '<span style="color: ' + TYPE[entry[R_TYPE]].color + '">[<a href=javascript:void(0)>x</a>] to be reported: ' + entry[R_POST] + ' on /' + entry[R_BOARD] + '/</span><br>';
        }
    }
    reporting_div[0].innerHTML = rdih[0];
    reporting_div[1].innerHTML = rdih[1];

    var links1 = document.evaluate(".//a", reporting_div[0], null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    var links2 = document.evaluate(".//a", reporting_div[1], null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (var i = 0; i < queue.length; i++) {
        var entry = queue[i].split("\t");
        var link = (i < ncaptchas) ? links1.snapshotItem(i) : links2.snapshotItem(i - ncaptchas);
        link.addEventListener("click", cancel_report.bind(null, entry[R_BOARD], entry[R_POST]), false);
    }

    refresh_reports.queue_cache = queue.join("\n");
    refresh_reports.captcha_cache = ncaptchas;
}
refresh_reports.queue_cache = "";
refresh_reports.captcha_cache = 0;

var return_captcha_timeoutID = null;
function add_captcha() {
    document.body.removeEventListener("mouseup", return_captcha, true);
    if (return_captcha_timeoutID != null) clearTimeout(return_captcha_timeoutID);
    $("r_captcha_div").style.display = "block";
    reg_callback("setup_captcha", function() {
        window_eval('Recaptcha.focus_response_field()');
        $("recaptcha_response_field").addEventListener("blur", function(e) {
            if (mouse_down) {
                document.body.addEventListener("mouseup", return_captcha, true);
                return_captcha_timeoutID = setTimeout(return_captcha, BLUR_DELAY);
            } else {
                return_captcha();
            }
        }, false);
        $("recaptcha_response_field").addEventListener("keypress", function(e) {
            if (e.keyCode == 13) {
                var challenge = $("recaptcha_challenge_field").value;
                var response = $("recaptcha_response_field").value;
                captcha_queue.push(escape(challenge) + " " + escape(response) + " " + new Date().getTime());
                refresh_reports();
                wait_to_report();
                if (report_queue.size() > captcha_queue.size()) {
                    window_eval('Recaptcha.reload()');
                } else {
                    return_captcha();
                }
            } else if (e.keyCode == 8 && $("recaptcha_response_field").value == "") {
                window_eval('Recaptcha.reload()');
            }
        }, false);
    });
    window_eval('Recaptcha.create("' + PUBLIC_KEY + '", "r_captcha_div", {callback: setup_captcha})');
}

function return_captcha() {
    document.body.removeEventListener("mouseup", return_captcha, true);
    if (return_captcha_timeoutID != null) clearTimeout(return_captcha_timeoutID);
    $("r_captcha_div").style.display = "none";
    if (showing_captcha() && $("recaptcha_widget_div")) {
        window_eval('Recaptcha.create("' + PUBLIC_KEY + '", "recaptcha_widget_div")');
    }
}

function showing_captcha() {
    return $("recaptcha_response_field") && ($("recaptcha_response_field").compareDocumentPosition($("r_captcha_div")) & DOCUMENT_POSITION_CONTAINS);
}

function refresh_settings() {
    hide_posts = GM_getValue("hide_spam_" + board, false);
    reports_mode = GM_getValue("reports_mode", SHOW_REPORTS);
    hide_types = GM_getValue("hide_types", DEFAULT_HIDE_TYPES.join(" ")).split(" ");
    autorefresh = GM_getValue("autorefresh", false);
    controls_position = GM_getValue("controls_position", "TR");
    if (show_hide_switch) show_hide_switch.set(hide_posts);
    if (hide_reports_switch) hide_reports_switch.set(reports_mode);
    for (var type in hide_types_switches) {
        hide_types_switches[type].set(has(hide_types, type));
    }
    if (autorefresh_switch) autorefresh_switch.set(autorefresh);
    if (position_switch) position_switch.set(controls_position);
}

function load_cache() {
    cache = {};
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i] != "OK") {
        cache[TYPES[i]] = GM_getValue(TYPES[i] + "_cache_" + board, "").split(" ");
    }
}

function read_posts(root_node) {
    var nodes = document.evaluate(".//*[self::a and @href or self::hr]", root_node, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    var curr_thread = null;
    if (in_thread) curr_thread = page_thread;
    cache = null;
    for (var i = 0; i < nodes.snapshotLength; i++) {
        var node = nodes.snapshotItem(i);
        if (node.tagName == "A") {
            if (has(node.hash, "#q") || has(node.href, "javascript:quote")) {
                if (!cache) load_cache();
                var post = new Post(node, curr_thread);
                if (curr_thread == null) curr_thread = post;
            }
        } else if (node.tagName == "HR") {
            curr_thread = null;
        }
    }
}

function query_spam() {
    var spam_params = {board: board, version: VERSION};
    var post_list = [];
    for (var num in posts) {
        if (in_index || (posts[num].hiding_qlink == null && posts[num] != page_thread)) post_list.push(num);
    }
    if (post_list.length > 0) spam_params.posts = post_list.join(" ");
    if (page_thread) spam_params.thread = page_thread.num;
    if (post_list.length > 0 || page_thread) {
        load_data(
            SERVER_ROOT + "spam.py?" + encode(spam_params),
            function(response) {
                load_cache();
                for (var num in posts) {
                    if (posts[num].type != "phide") {
                        posts[num].set_type(response.spam_list[num] || "OK");
                    }
                }
                if (response.message) {
                    message = response.message;
                    if ($("update_div")) {
                        $("update_div").innerHTML = response.message;
                        $("update_div").style.display = "block";
                    }
                }
            }
        );
    }
}

function position_controls() {
    controls.style.position = "fixed";
    controls.style.top    = has(controls_position, "B") ? "auto" : "15px";
    controls.style.bottom = has(controls_position, "T") ? "auto" : "15px";
    controls.style.left   = has(controls_position, "R") ? "auto" : "15px";
    controls.style.right  = has(controls_position, "L") ? "auto" : "15px";
}

if (document.title == "4chan - 404" && in_thread) {
    var thread = location.href.match(/\/res\/(\d+)/);
    if (thread) {
        thread = thread[1];
        load_data(SERVER_ROOT + "gone.py?" + encode({board: board, thread: thread}));
    }
}

if (in_index || in_thread) {
    refresh_settings();

    // add reCAPTCHA if not present
    window_eval('\
        if (typeof(Recaptcha) == "undefined") {\
            var rs = document.createElement("script");\
            rs.src = "http://api.recaptcha.net/js/recaptcha_ajax.js";\
            document.body.appendChild(rs);\
        }\
    ');

    // Track mouse state
    document.body.addEventListener("mousedown", function(e) {
        mouse_down = true;
    }, true);
    document.body.addEventListener("mouseup", function(e) {
        mouse_down = false;
    }, true);

    // Fix CAPTCHA size
    if ($("recaptcha_widget_div")) {
        $("recaptcha_widget_div").style.height = $("recaptcha_widget_div").clientHeight;
        $("recaptcha_widget_div").style.width = $("recaptcha_widget_div").clientWidth;
    }

    // Read posts, query database which posts are spam
    read_posts(document);
    query_spam();

    // Handle thread updates
    document.body.addEventListener("DOMNodeInserted", function(e) {
        setTimeout(function() {
            read_posts(e.target);
        }, 0);
    }, false);
    var last_query = new Date().getTime();
    document.body.addEventListener("mousemove", function(e) {
        if (autorefresh && new Date().getTime() > last_query + UPDATE_DELAY) {
            last_query = new Date().getTime();
            query_spam();
        }
    }, false);

    // Create upper right corner controls
    controls = document.createElement("div");
    controls.innerHTML
        = '<div id="update_div" style="display: none; text-align: center;"></div>'
        + '<div id="spam_count" style="text-align: center; font-style: italic; font-weight: bold;"></div>'
        + '<div id="switches_div" style="text-align: center;">'
            + '<div id="show_hide_switch">[<a>show</a> | <a>hide</a>]</div>'
            + '<div id="options_switch">[<a>options</a>]</div>'
        + '</div>'
        + '<div id="options_div" style="display: none; text-align: center;">'
            + '<hr>'
            + '<div id="hide_reports_switch">[<a>show</a> | <a>hide</a> | <a>no</a>] reports</div>'
            + '<div id="hide_types">hide ' + TYPES_HTML + '</div>'
            + '<div id="autorefresh_switch">autorefresh [<a>on</a> | <a>off</a>]</div>'
            + '<div id="position_switch">position [<a>TL</a> | <a>TR</a> | <a>BL</a> | <a>BR</a>]</div>'
            + '<div><span id="num_captchas"></span> captchas [<span id="captcha_add"><a>add</a></span>] [<span id="captcha_clear"><a>clear</a></span>]</div>'
            + '<hr>'
        + '</div>'
        + '<div id="msg_div"></div>'
        + '<div id="reporting_div1"></div>'
        + '<div id="need_div" style="text-align: center;">'
            + 'need <span id="need_span"></span> captchas [<span id="captcha_add2"><a>add</a></span>]'
        + '</div>'
        + '<div id="r_captcha_div" style="display: none;"></div>'
        + '<div id="reporting_div2"></div>';
    position_controls();
    document.body.appendChild(controls);

    if (message) {
        $("update_div").innerHTML = response.message;
        $("update_div").style.display = "block";
    }

    refresh_spam_count();

    show_hide_switch = new Color_switch(
        $("show_hide_switch"),
        ["green", "red"],
        [false, true],
        hide_posts,
        function(new_value) {
            hide_posts = new_value;
            GM_setValue("hide_spam_" + board, hide_posts);
            for (var num in posts) posts[num].refresh_hidden();
            show_hide_switch.set(hide_posts);
        }
    );

    options_switch = new Color_switch(
        $("options_switch"),
        ["black"],
        [true],
        false,
        function(new_value) {
            if ($("options_div").style.display == "none") {
                $("options_div").style.display = "block";
                options_switch.set(true);
            } else {
                $("options_div").style.display = "none";
                options_switch.set(false);
            }
        }
    );

    hide_reports_switch = new Color_switch(
        $("hide_reports_switch"),
        ["green", "red", "black"],
        [SHOW_REPORTS, HIDE_REPORTS, NO_REPORTS],
        reports_mode,
        function(new_value) {
            var old_value = reports_mode;
            reports_mode = new_value;
            if (old_value == NO_REPORTS && new_value != NO_REPORTS) {
                wait_to_report(new Date().getTime() + REPORT_DELAY);
            }
            GM_setValue("reports_mode", reports_mode);
            hide_reports_switch.set(reports_mode);
            refresh_reports();
        }
    );

    var node = $("hide_types").firstChild;
    for (var i = 0; i < TYPES.length; i++) {
        var type = TYPES[i];
        while (node.tagName != "A") node = node.nextSibling;
        hide_types_switches[type] = new Color_switch(
            node,
            [TYPE[type].color],
            [true],
            has(hide_types, type),
            function(new_value) {
                var n = hide_types.indexOf(this.type);
                if (n == -1) {
                    hide_types.push(this.type);
                    hide_types_switches[this.type].set(true);
                } else {
                    hide_types.splice(n, 1);
                    hide_types_switches[this.type].set(false);
                }
                GM_setValue("hide_types", hide_types.join(" "));
                for (var num in posts) posts[num].refresh_hidden();
                refresh_spam_count();
            }
        );
        hide_types_switches[type].type = type;
        node = node.nextSibling;
    }

    autorefresh_switch = new Color_switch(
        $("autorefresh_switch"),
        ["green", "red"],
        [true, false],
        autorefresh,
        function(new_value) {
            autorefresh = new_value;
            GM_setValue("autorefresh", autorefresh);
            autorefresh_switch.set(autorefresh);
        }
    );

    position_switch = new Color_switch(
        $("position_switch"),
        ["black", "black", "black", "black"],
        ["TL", "TR", "BL", "BR"],
        controls_position,
        function(new_value) {
            controls_position = new_value;
            GM_setValue("controls_position", controls_position);
            position_switch.set(controls_position);
            position_controls();
        }
    );

    $("captcha_add").addEventListener("click", add_captcha, false);
    $("captcha_add2").addEventListener("click", add_captcha, false);
    $("captcha_clear").addEventListener("click", function() {
        if (confirm("Are you sure you want to clear all stored CAPTCHAs?")) {
            captcha_queue.set([]);
            refresh_reports();
        }
    }, false);

    refresh_reports();

    // Track window changes
    document.addEventListener("focus", function(e) {
        var prev_window = GM_getValue("current_window", -1);
        if (prev_window == window_id) return;
        GM_setValue("current_window", window_id);
        $("msg_div").innerHTML = "";
        refresh_settings();
        load_cache();
        for (var num in posts) {
            posts[num].refresh_type();
            posts[num].refresh_hidden();
        }
        refresh_spam_count();
        refresh_reports();
        wait_to_report();
    }, false);
    GM_setValue("current_window", window_id);

    // Start post reporter
    wait_to_report();
}

})();
