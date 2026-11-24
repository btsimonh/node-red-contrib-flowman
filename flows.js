
module.exports = function (RED) {
    "use strict";
    var fs = require("fs");
    var fspath = require("path");
    var util = require('util');

    // The flow add/remove/get API is not part of the API given to nodes, so
    // reach into the node-red module itself (as earlier versions did).
    // Resolved lazily, so a failure is reported on use rather than at load.
    var RED2 = null;
    function runtime() {
        if (!RED2) {
            try {
                RED2 = require.main.require('node-red');
            } catch (e) {
                RED2 = require('node-red');
            }
        }
        return RED2;
    }

    function generateId() {
        if (RED.util && typeof RED.util.generateId === 'function') {
            return RED.util.generateId();
        }
        return runtime().util.generateId();
    }

    function clone(a) {
        return JSON.parse(JSON.stringify(a));
    }

    // turn whatever was thrown/rejected into a readable string
    function errText(e) {
        if (e === undefined || e === null) {
            return 'unknown error';
        }
        if (typeof e === 'string') {
            return e;
        }
        if (e.message) {
            return e.message;
        }
        if (e.code === 404) {
            return 'flow not found';
        }
        return util.inspect(e);
    }

    // Node-RED >= 1.0 passes send/done to input handlers; make sure we
    // always have usable versions.
    function sendFn(node, send) {
        return send || function () { node.send.apply(node, arguments); };
    }
    function doneFn(done) {
        return done || function () {};
    }

    /////////////////////////////////////////////////
    // A single queue of flow add/remove operations, shared by addflow and
    // delflow. Each operation causes a deploy of the flows, so they must
    // run one at a time.
    //
    // A job is { run: fn -> value|promise, ok: fn(result), fail: fn(err) }.
    // run() may throw synchronously or return a rejected promise (Node-RED
    // 1.x throws synchronously for e.g. 'flow not found', later versions
    // reject). Either way, only that job fails, and the queue always moves on.
    var queue = [];
    var busy = false;

    function enqueue(job) {
        queue.push(job);
        if (!busy) {
            runNext();
        }
    }

    function runNext() {
        if (!queue.length) {
            busy = false;
            return;
        }
        busy = true;
        var job = queue.shift();
        Promise.resolve()
            .then(function () { return job.run(); })
            .then(
                function (result) { job.ok(result); },
                function (err) { job.fail(err); }
            )
            .catch(function (err) {
                // only reached if ok()/fail() themselves threw
                RED.log.error("flowman: " + errText(err));
            })
            .then(runNext);
    }

    /////////////////////////////////////////////////
    // delete the current flow, or if msg.flowId, that flow
    function delflow(n) {
        RED.nodes.createNode(this, n);
        this.name = n.name;
        this.enabled = n.enabled || false;
        var node = this;
        node.on('input', function (msg, send, done) {
            send = sendFn(node, send);
            done = doneFn(done);

            var id = node.z;
            if (msg.flowId) {
                id = msg.flowId;
            }

            // if we are not deleting this flow, then send on the input msg
            var outputmsg = (id !== node.z);

            if (!node.enabled) {
                // if inhibited, always send msg on
                node.warn("delete flow " + id + " inhibited");
                msg.err = "delete flow " + id + " inhibited";
                send(msg);
                done();
                return;
            }

            enqueue({
                run: function () {
                    return runtime().nodes.removeFlow(id);
                },
                ok: function () {
                    node.log("deleted flow " + id);
                    if (outputmsg) {
                        send(msg);
                    }
                    done();
                },
                fail: function (err) {
                    // if we did not delete, always pass on input msg
                    // with err set
                    msg.err = "failed to delete flow " + id + ": " + errText(err);
                    node.error(msg.err);
                    send(msg);
                    done();
                }
            });
        });
    }
    RED.nodes.registerType("delflow", delflow);


    /////////////////////////////////////////////////
    // add a flow from msg.payload.
    // all nodes are given new ids, with wiring corrected.
    function addflow(n) {
        RED.nodes.createNode(this, n);
        this.name = n.name;
        var node = this;
        node.on('input', function (msg, send, done) {
            send = sendFn(node, send);
            done = doneFn(done);

            function reject(text) {
                node.error(text);
                msg.err = text;
                send(msg);
                done();
            }

            var flow;
            try {
                if (typeof msg.payload === 'string') {
                    flow = JSON.parse(msg.payload);
                } else {
                    // work on a copy, so msg.payload is passed on untouched
                    flow = clone(msg.payload);
                }
            } catch (err) {
                return reject("did not addFlow - payload is not valid JSON: " + errText(err));
            }

            if (!flow || typeof flow !== 'object' || !Array.isArray(flow.nodes)) {
                return reject("did not addFlow - no .nodes found");
            }

            if (typeof flow.label !== 'string') {
                return reject("did not addFlow - no .label found");
            }

            try {
                modifyflow(flow);
            } catch (err) {
                return reject("did not addFlow - " + errText(err));
            }

            enqueue({
                run: function () {
                    return runtime().nodes.addFlow(flow);
                },
                ok: function (newflowid) {
                    msg.flowId = newflowid;
                    send(msg);
                    done();
                },
                fail: function (err) {
                    msg.err = "failed to add flow " + flow.label + ": " + errText(err);
                    node.error(msg.err);
                    send(msg);
                    done();
                }
            });
        });
    }
    RED.nodes.registerType("addflow", addflow);


    function newids(nodes, ins, outs) {
        var l = nodes.length;
        // generate new node ids,
        // and replace any of each old id with the new id
        for (var a = 0; a < l; a++) {
            var orgnodeid = nodes[a].id;
            var newid = generateId();
            nodes[a].id = newid;

            var i, o, w;
            if (ins) {
                // rewire ins and outs of subflow
                for (i = 0; i < ins.length; i++) {
                    for (w = 0; w < ins[i].wires.length; w++) {
                        if (ins[i].wires[w].id === orgnodeid) {
                            ins[i].wires[w].id = newid;
                        }
                    }
                }
            }

            if (outs) {
                for (o = 0; o < outs.length; o++) {
                    for (w = 0; w < outs[o].wires.length; w++) {
                        if (outs[o].wires[w].id === orgnodeid) {
                            outs[o].wires[w].id = newid;
                        }
                    }
                }
            }

            for (var b = 0; b < l; b++) {
                var nb = nodes[b];
                if (Array.isArray(nb.wires)) {
                    for (var c = 0; c < nb.wires.length; c++) {
                        var wire = nb.wires[c];
                        if (Array.isArray(wire)) {
                            for (var d = 0; d < wire.length; d++) {
                                if (wire[d] === orgnodeid) {
                                    wire[d] = newid;
                                }
                            }
                        }
                    }
                }

                // replace in any keys which mention the old id -
                // this will hook up configuration nodes
                // e.g. serial, mqtt, etc.
                // and if a key is an array (e.g. scope of catch/status
                // nodes, links of link nodes, nodes of groups), replace
                // the old id within the array.
                var keys = Object.keys(nb);
                for (var k = 0; k < keys.length; k++) {
                    var key = keys[k];
                    // never references to other nodes
                    if (key === 'id' || key === 'type' || key === 'name') {
                        continue;
                    }
                    var val = nb[key];
                    if (val === orgnodeid) {
                        nb[key] = newid;
                    } else if (Array.isArray(val)) {
                        for (var idx = 0; idx < val.length; idx++) {
                            if (val[idx] === orgnodeid) {
                                val[idx] = newid;
                            }
                        }
                    }
                }
            }
        }
    }

    function isSubflowInstance(n) {
        return (typeof n.type === 'string') && (n.type.indexOf("subflow:") === 0);
    }

    // flatten ONE subflow instance found in f with .z === z.
    // returns true if one was found (so call again until false)
    function flattensubflows(f, z, newz) {
        var nodes = f.nodes;

        if (!newz) {
            newz = z;
        }
        var l = nodes.length;

        for (var a = 0; a < l; a++) {
            // if node in this flow/subflow
            if (nodes[a].z !== z || !isSubflowInstance(nodes[a])) {
                continue;
            }
            var subflowid = nodes[a].type.slice(8);
            var subflow = null;
            var b;

            // find subflow
            for (b = 0; b < l; b++) {
                if (nodes[b].id === subflowid && nodes[b].type === 'subflow') {
                    subflow = nodes[b];
                    break;
                }
            }
            if (!subflow) {
                throw new Error("subflow definition " + subflowid + " used by node " +
                    nodes[a].id + " is not present in the flow");
            }

            // now get all the nodes which belong to this subflow.
            // and duplicate them into subnodes
            var subnodes = [];
            for (b = 0; b < l; b++) {
                if (nodes[b].z === subflowid) {
                    var nnode = clone(nodes[b]);
                    nnode.z = newz;
                    subnodes.push(nnode);
                }
            }

            var ins = clone(subflow.in || []);
            var outs = clone(subflow.out || []);

            // now give them unique ids, reconnect internal wires, and connect
            // external wires
            newids(subnodes, ins, outs);

            // retain the subnodeinstance
            var OrgSubflowInstance = nodes[a];
            // remove original from list
            nodes.splice(a, 1);
            // add in our new nodes, else we won't find them in rewire
            nodes = nodes.concat(subnodes);

            var subflowname = OrgSubflowInstance.name;
            if (!subflowname) {
                subflowname = subflow.name;
            }
            if (!subflowname) {
                subflowname = "subflow";
            }

            var instwires = OrgSubflowInstance.wires || [];

            // an input and output nodes
            var inputnode = {
                id: OrgSubflowInstance.id, // so inputs are already routed
                type: "function",
                z: f.id,
                name: subflowname + "-in",
                func: "\nreturn msg;",
                outputs: 1,
                noerr: 0,
                x: OrgSubflowInstance.x,
                y: OrgSubflowInstance.y,
                wires: [[]] // empty to start
            };
            if (OrgSubflowInstance.g) {
                inputnode.g = OrgSubflowInstance.g;
            }

            var outputnodes = [];
            // create as many as we have 'outs', regardless of connection
            for (var out = 0; out < outs.length; out++) {
                var output = {
                    id: generateId(),
                    type: "function",
                    z: f.id,
                    name: subflowname + "-out" + (out + 1),
                    func: "\nreturn msg;",
                    outputs: 1,
                    noerr: 0,
                    x: OrgSubflowInstance.x + 100,
                    y: OrgSubflowInstance.y + out * 40,
                    wires: [instwires[out] ? clone(instwires[out]) : []]
                };
                if (OrgSubflowInstance.g) {
                    output.g = OrgSubflowInstance.g;
                }
                outputnodes.push(output);
            }

            // add input and output nodes; so we can find them in the next bit
            nodes.push(inputnode);
            nodes = nodes.concat(outputnodes);
            f.nodes = nodes;
            l = nodes.length;

            // wire up input and outputs

            // output must get sent from all mentioned in outs
            for (var out1 = 0; out1 < outs.length; out1++) {
                for (var outw = 0; outw < outs[out1].wires.length; outw++) {
                    var dest = outputnodes[out1].id;
                    var src = outs[out1].wires[outw].id;
                    var srcport = outs[out1].wires[outw].port;

                    // if out connected directly to in, then do so.
                    if (src === subflow.id) {
                        src = inputnode.id;
                        srcport = 0;
                    }

                    // find src, and add our node as a dest
                    for (var srcnode = 0; srcnode < l; srcnode++) {
                        if (nodes[srcnode].id === src) {
                            if (!Array.isArray(nodes[srcnode].wires)) {
                                nodes[srcnode].wires = [];
                            }
                            while (!nodes[srcnode].wires[srcport]) {
                                nodes[srcnode].wires.push([]);
                            }
                            nodes[srcnode].wires[srcport].push(dest);
                        }
                    }
                }
            }

            // input must send to all mentioned in ins
            for (var inp = 0; inp < ins.length; inp++) {
                for (var inpw = 0; inpw < ins[inp].wires.length; inpw++) {
                    inputnode.wires[0].push(ins[inp].wires[inpw].id);
                }
            }

            // must start again, as we've updated the nodes.
            return true;
        }
        return false;
    }

    // parses a flow, and makes a new id
    // for each id we come accross, correctly
    // re-linking wiring. Modifies f in place; throws on failure.
    function modifyflow(f) {
        var l = f.nodes.length;
        var a;
        if (!f.id) {
            //find the first z which is NOT an id
            for (a = 0; a < l; a++) {
                var z = f.nodes[a].z;
                if (z) {
                    var found = false;
                    for (var b = 0; b < l; b++) {
                        if (z === f.nodes[b].id) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        f.id = z;
                        break;
                    }
                }
            }
        }

        if (!f.id) {
            throw new Error("no flow id found (set .id, or .z on the nodes)");
        }

        var flowid = f.id;
        f.id = generateId();

        var nodes = f.nodes;
        for (a = 0; a < l; a++) {
            var n = nodes[a];
            // first, modify owner of node.
            if (n.z === flowid) {
                n.z = f.id;
            } else if (!n.z && n.type !== 'tab' && n.type !== 'subflow') {
                // config nodes normally have z = "" (or no z), give them us
                // instead.
                // this means that they will be deleted when the flow is deleted.
                n.z = f.id;
            }
        }

        // for each subflow, flatten it.
        // call until we find no more; each iteration
        // flattens one level
        while (flattensubflows(f, f.id)) {
            // keep going
        }

        // generate new node ids,
        // and replace any of each old id with the new id
        newids(f.nodes);

        // finally discard anything not marked with our z
        f.nodes = f.nodes.filter(function (onode) {
            return (onode.z === f.id) &&
                (onode.type !== 'tab') &&
                (onode.type !== 'subflow') &&
                !isSubflowInstance(onode);
        });
    }


    /////////////////////////////////////////////////
    // file helpers for saveflow

    // make a flow label / node name safe to use as a single path element
    function safeName(name) {
        var s = String(name).replace(/[<>:"\/\\|?*\x00-\x1F]/g, '_');
        // windows does not allow trailing dots or spaces
        s = s.replace(/[. ]+$/, '');
        if (s === '' || s === '.' || s === '..') {
            s = '_';
        }
        return s;
    }

    function writeFile(filename, content) {
        try {
            fs.writeFileSync(filename, content, { encoding: "utf8" });
        } catch (err) {
            if (err.code !== "ENOENT") {
                throw err;
            }
            // create the folder, and try again
            fs.mkdirSync(fspath.dirname(filename), { recursive: true });
            fs.writeFileSync(filename, content, { encoding: "utf8" });
        }
    }

    // save the current flow, or if msg.flowId, that flow, or 'all'
    function saveflow(n) {
        RED.nodes.createNode(this, n);
        this.name = n.name || '';
        this.path = n.path || '';
        this.enabled = n.enabled || false;
        this.exporttype = n.exporttype || 'original';
        var node = this;
        var timer = null;

        // call input in 100ms
        if (this.enabled) {
            timer = setTimeout(function () {
                timer = null;
                node.emit("input", {});
            }, 100);
        }

        node.on('close', function () {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        });

        node.on('input', function (msg, send, done) {
            send = sendFn(node, send);
            done = doneFn(done);

            var pname = '';
            var pext = '.flow';
            var errs = [];
            var pathin = node.path;

            if (msg.filename) {
                pathin = String(msg.filename);
            }

            var ppath = pathin;

            if (pathin.length < 1) {
                errs.push('no path set');
                node.error("no path set", msg);
                msg.errs = errs;
                send(msg);
                done();
                return;
            }

            var endc = pathin.slice(-1);
            if ((endc !== '/') && (endc !== '\\')) {
                var parsed = fspath.parse(pathin);
                pname = parsed.name;
                pext = parsed.ext;
                ppath = parsed.dir;
                if (pext === '') {
                    pext = '.flow';
                }
            }

            var ids = [node.z];
            if (msg.flowId) {
                ids = msg.flowId;
            }

            if (ids === 'all') {
                ids = [];
                try {
                    // read all flow ids from whole of node-red
                    var allnodes = runtime().nodes.getFlows().flows;
                    for (var t = 0; t < allnodes.length; t++) {
                        if (allnodes[t].type === 'tab') {
                            ids.push(allnodes[t].id);
                        }
                    }
                } catch (err) {
                    errs.push(errText(err));
                    node.error("could not list flows: " + errText(err), msg);
                }

                // if we thought we had an exact name, but have multiple
                // flows, then reset and add a slash
                if (pname) {
                    pname = '';
                    ppath = pathin + '/';
                }
            } else if (!Array.isArray(ids)) {
                ids = [ids];
            }

            var writenodes = function (dir, nodes) {
                for (var a = 0; a < nodes.length; a++) {
                    var fn = nodes[a];
                    if (fn.type !== 'function') {
                        continue;
                    }
                    var base = fn.name ? safeName(fn.name) : safeName(fn.id);
                    var parts = [
                        { suffix: '.js', code: fn.func },
                        // Node-RED >= 1.1 function nodes have setup/close code
                        { suffix: '.initialize.js', code: fn.initialize },
                        { suffix: '.finalize.js', code: fn.finalize }
                    ];
                    for (var p = 0; p < parts.length; p++) {
                        var code = parts[p].code;
                        // always write main func; only write others if used
                        if (p > 0 && (typeof code !== 'string' || code.trim() === '')) {
                            continue;
                        }
                        var filename2 = fspath.join(dir, base + parts[p].suffix);
                        try {
                            writeFile(filename2, code || '');
                        } catch (err) {
                            errs.push(err.toString());
                            node.error("writefail function " + err.toString(), msg);
                        }
                    }
                }
            };

            for (var i = 0; i < ids.length; i++) {
                var id = ids[i];

                try {
                    var flowcomplete = getflow(id, node.exporttype);

                    var name = safeName(flowcomplete.label || flowcomplete.id);

                    // if name is to be overridden
                    if (pname !== '') {
                        name = pname;
                    }

                    var filename = fspath.join(ppath, name + pext);
                    var filespath = fspath.join(ppath, name);

                    var json;
                    if (node.exporttype === 'addflow') {
                        json = JSON.stringify(flowcomplete, null, '\t');
                    } else {
                        // 'clipboardexport', 'original'
                        json = JSON.stringify(flowcomplete.nodes, null, '\t');
                    }

                    try {
                        writeFile(filename, json);
                    } catch (err) {
                        errs.push(err.toString());
                        node.error("writefail flow " + err.toString(), msg);
                        continue;
                    }
                    writenodes(filespath, flowcomplete.nodes);

                } catch (err) {
                    errs.push(errText(err));
                    node.error("saveflow " + id + ": " + errText(err), msg);
                }
            }

            if (errs.length) {
                msg.errs = errs;
            }
            // if we still exist, and want to pass the msg on...
            send(msg);
            done();
        });
    }
    RED.nodes.registerType("saveflow", saveflow);


    /////////////////////////////////////////////////
    // function gets a complete flow in the form {id:<id>, label:<label>, nodes:[ the nodes ]}
    // if exporttype is not 'original', then subflows and config nodes are included.
    // used by getflows node, and by saveflows node.
    // throws if the flow does not exist.
    function getflow(id, exporttype) {
        exporttype = exporttype || 'addflow';
        var nodesApi = runtime().nodes;
        var flow = nodesApi.getFlow(id);
        if (!flow || !Array.isArray(flow.nodes)) {
            throw new Error("flow not found: " + util.inspect(id));
        }

        var nodes = [];
        var nodes_map = {};
        var includeExtras = (exporttype !== 'original');
        var globalnodes = includeExtras ? (nodesApi.getFlow('global') || {}) : {};

        function subflowIdOf(n) {
            if (n.subflow !== undefined) {
                return n.subflow;
            }
            if (isSubflowInstance(n)) {
                return n.type.slice(8);
            }
            return undefined;
        }

        function stripRuntime(n) {
            delete n.subflow;
            delete n._users;
            delete n.credentials;
            return n;
        }

        // note any subflows in use, including subflows used within subflows
        var subflow_map = {};
        var a;
        for (a = 0; a < flow.nodes.length; a++) {
            var sid = subflowIdOf(flow.nodes[a]);
            if (sid !== undefined) {
                subflow_map[sid] = true;
            }
        }

        // add in subflows that we are using
        if (includeExtras && Array.isArray(globalnodes.subflows)) {
            var added = true;
            var subflowsAdded = {};
            while (added) {
                added = false;
                for (var c = 0; c < globalnodes.subflows.length; c++) {
                    var gsubflow = globalnodes.subflows[c];
                    if (!subflow_map[gsubflow.id] || subflowsAdded[gsubflow.id]) {
                        continue;
                    }
                    subflowsAdded[gsubflow.id] = true;
                    added = true;

                    // push parts of the subflow
                    var copied = clone(gsubflow);
                    delete copied.nodes;
                    delete copied.configs;
                    delete copied.instances;
                    nodes.push(copied);
                    nodes_map[copied.id] = copied;

                    // push all its nodes, and note nested subflows
                    var sfnodes = gsubflow.nodes || [];
                    for (var sn = 0; sn < sfnodes.length; sn++) {
                        var nested = subflowIdOf(sfnodes[sn]);
                        if (nested !== undefined) {
                            subflow_map[nested] = true;
                        }
                        var sfnode = stripRuntime(clone(sfnodes[sn]));
                        nodes.push(sfnode);
                        // so we can identify configs in use next
                        nodes_map[sfnode.id] = sfnode;
                    }
                    // configs local to the subflow
                    var sfconfigs = gsubflow.configs || [];
                    for (var sc = 0; sc < sfconfigs.length; sc++) {
                        var sfconfig = stripRuntime(clone(sfconfigs[sc]));
                        if (nodes_map[sfconfig.id] === undefined) {
                            nodes.push(sfconfig);
                            nodes_map[sfconfig.id] = sfconfig;
                        }
                    }
                }
            }
        }

        // push everything in our flow
        // (hopefully, we get the same order as a gui export)
        for (a = 0; a < flow.nodes.length; a++) {
            var flownode = stripRuntime(clone(flow.nodes[a]));
            nodes.push(flownode);
            nodes_map[flownode.id] = flownode;
        }

        // add in config nodes which reference any of our nodes in _users
        if (includeExtras && Array.isArray(globalnodes.configs)) {
            for (var g = 0; g < globalnodes.configs.length; g++) {
                var gnode = globalnodes.configs[g];
                if (!Array.isArray(gnode._users) || nodes_map[gnode.id] !== undefined) {
                    continue;
                }
                for (var u = 0; u < gnode._users.length; u++) {
                    if (nodes_map[gnode._users[u]] !== undefined) {
                        // want to remove _users, and put it IN our flow
                        var gcopied = stripRuntime(clone(gnode));
                        nodes.push(gcopied);
                        nodes_map[gcopied.id] = gcopied;
                        break;
                    }
                }
            }
        }

        // add in any in-flow configs
        if (Array.isArray(flow.configs)) {
            for (var fc = 0; fc < flow.configs.length; fc++) {
                var fcopied = stripRuntime(clone(flow.configs[fc]));
                // don't add a config node twice
                if (nodes_map[fcopied.id] === undefined) {
                    nodes.push(fcopied);
                    nodes_map[fcopied.id] = fcopied;
                }
            }
        }

        var exportflow = {
            id: id,
            label: flow.label,
            disabled: flow.disabled,
            nodes: nodes
        };
        if (flow.info !== undefined) {
            exportflow.info = flow.info;
        }
        if (flow.env !== undefined) {
            exportflow.env = flow.env;
        }
        return exportflow;
    }


    /////////////////////////////////////////////////
    // get the list of flows, or if msg.id, that flow
    function getflows(n) {
        RED.nodes.createNode(this, n);
        this.name = n.name || '';
        var node = this;

        node.on('input', function (msg, send, done) {
            send = sendFn(node, send);
            done = doneFn(done);
            msg.thisflow = node.z;

            if (msg.id !== undefined) {
                try {
                    msg.payload = getflow(msg.id);
                } catch (e) {
                    delete msg.payload;
                    msg.err = 'could not get flow ' + util.inspect(msg.id) + ' ' + errText(e);
                }
            } else {
                try {
                    var flows = [];
                    // read all flow ids from whole of node-red
                    var allnodes = runtime().nodes.getFlows().flows;
                    for (var i = 0; i < allnodes.length; i++) {
                        if (allnodes[i].type === 'tab') {
                            // duplicate so we don't give ability to modify
                            flows.push({ id: allnodes[i].id, label: allnodes[i].label });
                        }
                    }
                    msg.payload = flows;
                } catch (e) {
                    delete msg.payload;
                    msg.err = 'could not get flows ' + errText(e);
                }
            }
            send(msg);
            done();
        });
    }
    RED.nodes.registerType("getflows", getflows);
};
