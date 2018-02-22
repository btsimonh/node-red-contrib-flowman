
module.exports = function (RED) {
    var fs = require.main.require("fs-extra");
    var fspath = require("path");
    var util = require('util');
    var RED2 = require.main.require('node-red');
    
    //console.log("RED is " + util.inspect(RED2));

    //console.log("loading flowman");
    
    // delete the current flow, or if msg.flowId, that flow
    function delflow(n) {
        RED.nodes.createNode(this, n);
        this.name = n.name;
        this.enabled = n.enabled || false;
        var node = this;
        node.on('input', function (msg) {
            var id = this.z;
            var outputmsg = false;
            if (msg.flowId) { 
                id = msg.flowId; 
            }
            
            // if we are not deleting this flow, then send on the input msg
            if (id !== this.z){
                outputmsg = true;
            }
           
            if (this.enabled){
                // a global queue of flows to be added
                // since each is done asynchrously, we must serialise.
                RED.nodes.config_flowman_flow_queue = RED.nodes.config_flowman_flow_queue || [];

                
                var process_del = function( s ){
                    // use the promise returned to emit a msg after delete is complete.
                    RED2.nodes.removeFlow(id).then(
                        function(){
                            node.log("deleted flow " + id);
                            RED.nodes.config_flowman_flow_queue = RED.nodes.config_flowman_flow_queue.slice(1);
                            // any more to do?
                            if (RED.nodes.config_flowman_flow_queue.length){
                                var p = RED.nodes.config_flowman_flow_queue[0];
                                // do the relevant command
                                p.cmd(p);
                            }
                            if (s.outputmsg){
                                s.node.send(s.msg);
                            }
                        }, 
                        function(){
                            RED.nodes.config_flowman_flow_queue = RED.nodes.config_flowman_flow_queue.slice(1);
                            node.error("failed to delete flow " + id + " " + util.inspect(e));
                            // if we did not delete, always pass on input msg
                            // with err set
                            s.msg.err = e;
                            // any more to do?
                            if (RED.nodes.config_flowman_flow_queue.length){
                                var p = RED.nodes.config_flowman_flow_queue[0];
                                // do the relevant command
                                p.cmd(p);
                            }
                            s.node.send(s.msg);
                        } ).catch(function(reason){
                                // remove the item we were trying to process.
                                // maybe someone tried to delete the SAME flow twice...
                                var p = RED.nodes.config_flowman_flow_queue[0];
                                // abort the whole queue, as we failed all future promises as well.
                                RED.nodes.config_flowman_flow_queue = [];
                                node.error("failed to delete flow " + p.id + " " + util.inspect(reason));
                                p.msg.err = reason;
                                p.node.send(p.msg);
                            });
                }
                
                // if we already have a global addflow queue, then add to it.
                RED.nodes.config_flowman_flow_queue.push(
                    { id: id, outputmsg: outputmsg, msg: msg, node: node, cmd: process_del }
                    );

                    
                // try to delete, but only next tick.
                //setTimeout(function(){
                // can't delay, we may have added one in the meantime
                        // if we just added one to the queue, and there is only one, do it now.
                        // to start the process of adding flows off.
                        // if more flows are added, the function will add them AFTER this one.
                        if (RED.nodes.config_flowman_flow_queue.length === 1){
                            var p = RED.nodes.config_flowman_flow_queue[0];
                            p.cmd(p);
                        }
                //    }, 1);
                    
            } else {
                // if inhibited, always send msg on
                node.warn("delete flow " + id + " inhibited");
                msg.err = "delete flow " + id + " inhibited";
                node.send(msg);
            }
        });
    }
    RED.nodes.registerType("delflow", delflow);

    //console.log("registered delflow");
    
    
    // add a flow from msg.payload.
    // a new flowid is created (twice! once here, and once in addFlow())
    // and all nodes are given new ids with wirng corrected.
    function addflow(n) {
        RED.nodes.createNode(this, n);
        this.name = n.name;
        var node = this;
        node.on('input', function (msg) {
            var flow = {};
            if (typeof msg.payload === 'string'){
                flow = JSON.parse(msg.payload);
            } else {
                flow = msg.payload;
            }
            
            if (!Array.isArray(flow.nodes)){
                node.error("did not addFlow - no .nodes found");
                msg.err = "did not addFlow - no .nodes found";
                return msg;
            }

            if (typeof flow.label !== 'string'){
                node.error("did not addFlow - no .label found");
                msg.err = "did not addFlow - no .label found";
                return msg;
            }

            
            try {
                //node.error("call modify");
                
                modifyflow(node, flow, msg);
                //node.error("done modify");
                //msg.payload = flow;
                //node.error("call addFlow");

                // a global queue of flows to be added
                // since each is done asynchroously, we must serialise.
                RED.nodes.config_flowman_flow_queue = RED.nodes.config_flowman_flow_queue || [];


                var process_add = function( s ){
                    var newflowidpromise = RED2.nodes.addFlow(s.flow);//, 'nodes');
                    newflowidpromise.then( function(newflowid){
                        // remove us because we are done
                        RED.nodes.config_flowman_flow_queue = RED.nodes.config_flowman_flow_queue.slice(1);
                        s.msg.flowId = newflowid;
                        // any more adds to do?
                        if (RED.nodes.config_flowman_flow_queue.length){
                            var p = RED.nodes.config_flowman_flow_queue[0];
                            // do the relevant command
                            p.cmd(p);
                        }
                        s.node.send(s.msg);
                    }, function(){
                        // remove us because we are failed
                        RED.nodes.config_flowman_flow_queue = RED.nodes.config_flowman_flow_queue.slice(1);
                        node.error("did not addFlow?");
                        s.msg.err = "did not addFlow?";
                        // any more adds to do?
                        if (RED.nodes.config_flowman_flow_queue.length){
                            var p = RED.nodes.config_flowman_flow_queue[0];
                            // do the relevant command
                            p.cmd(p);
                        }
                        node.send(s.msg);
                    }).catch(function(reason){
                        // remove the item we were trying to process.
                        // maybe someone tried to delete the SAME flow twice...
                        var p = RED.nodes.config_flowman_flow_queue[0];
                        // abort the whole queue, as we failed all future promises as well.
                        RED.nodes.config_flowman_flow_queue = [];
                        node.error("failed to add flow " + p.flow.label + " " + util.inspect(reason));
                        p.msg.err = reason;
                        p.node.send(p.msg);
                    });
                }
                
                // if we already have a global addflow queue, then add to it.
                RED.nodes.config_flowman_flow_queue.push(
                    { flow: flow, msg:msg, node:node, cmd: process_add }
                    );
                    

                // if we just added one to the queue, and there is only one, do it now.
                // to start the process of adding flows off.
                // if more flows are added, the function will add them AFTER this one.
                if (RED.nodes.config_flowman_flow_queue.length === 1){
                    var p = RED.nodes.config_flowman_flow_queue[0];
                    p.cmd(p);
                }
                
            } catch (err) {
                node.error(err.message);
                msg.err = "exception: did not addFlow";
                node.send(msg);
            }
            
            // don't return anything, as msgs may be sent from promises.
        });
    }
    RED.nodes.registerType("addflow", addflow);
    //console.log("registered addflow");

    
    function clone(a){
        return JSON.parse(JSON.stringify(a));
    }

    function newids(node, nodes, ins, outs){
        var l = nodes.length;
        // generate new node ids,
        // and replace any of each old id with the new id 
        for (var a = 0; a < l; a++){
            // now for each wire.
            var orgnodeid = nodes[a].id;
            nodes[a].id = RED2.util.generateId();
            //node.error("nodeid " + orgnodeid +"->"+nodes[a].id);

            if (ins){
                // rewire ins and outs of subflow
                for (var i = 0; i < ins.length; i++){
                    for (var w = 0; w < ins[i].wires.length; w++){
                        if (ins[i].wires[w].id === orgnodeid){
                            //node.error("ins " + ins[i].wires[w].id +"->"+nodes[a].id);
                            ins[i].wires[w].id = nodes[a].id; 
                        }
                    }
                }
            }

            if (outs){
                for (var o = 0; o < outs.length; o++){
                    for (var w = 0; w < outs[o].wires.length; w++){
                        if (outs[o].wires[w].id === orgnodeid){
                            //node.error("outs " + outs[o].wires[w].id +"->"+nodes[a].id);
                            outs[o].wires[w].id = nodes[a].id; 
                        }
                    }
                }
            }
            
            for (var b = 0; b < l; b++){
                if (nodes[b].wires){
                    if (nodes[b].wires.length){
                        for (var c = 0; c < nodes[b].wires.length; c++){
                            var wire = nodes[b].wires[c];
                            if (wire.length){
                                for (var d = 0; d < wire.length; d++){
                                    var w = wire[d];
                                    if (w === orgnodeid){
                                        nodes[b].wires[c][d] = nodes[a].id;
                                    }
                                }
                            }
                        }
                    }
                }
                
                // replace in any keys which mention the old id - 
                // this will hook up configuration nodes
                // e.g. serial, mqtt, etc.
                var keys = Object.keys(nodes[b]);
                keys.forEach(function(key){
                   if (nodes[b][key] === orgnodeid){
                       //console.log("found ref to " + orgnodeid + " in node " + nodes[b].id + " key " + key + " changed to " + nodes[a].id);
                       nodes[b][key] = nodes[a].id;
                   } 
                });
            }
        }
    }
    
    function flattensubflows(node, f, z, newz){
        var foundone = false;
        
        var nodes = f.nodes;
        
        if (!newz) 
            newz = z;
        var l = nodes.length;
        //node.error("flatten - newz " + newz);
        
        for (var a = 0; a < l; a++){
            // if node in this flow/subflow
            if (nodes[a].z === z){
                if (nodes[a].type.startsWith("subflow:")){
                    var subflowid = nodes[a].type.slice(8);
                    //node.error("flatten found subflow " + nodes[a].name);
                    var subflow = null;
                    var subflowindex = null;
                    
                    // find subflow
                    for (var b = 0; b < l; b++){
                        if (nodes[b].id === subflowid){
                            subflow = nodes[b];
                            subflowindex = b;
                            //node.error("subflow is of " + subflow.name);
                            break;
                        }
                    }

                    // now get all the nodes which belong to this subflow.
                    // and duplicate them into subnodes
                    var subnodes = [];
                    for (var b = 0; b < l; b++){
                        if (nodes[b].z === subflowid){
                            // duplicate
                            //var util = require('util');
                            var n = nodes[b];
                            //node.error("node:" + util.inspect(n));
                            var nnode = clone(n);
                            nnode.z = newz;
                            subnodes.push(nnode);
                            //node.error("subflow contains " + nnode.name + " type " + nnode.type );
                            //node.error("node:" + util.inspect(nnode));
                        }
                    }
                    
                    //node.error("ins:" + util.inspect(subflow.in, {depth:6}));
                    var ins = clone(subflow.in);
                    //node.error("ins:" + util.inspect(ins, {depth:6}));
                    //node.error("outs:" + util.inspect(subflow.out, {depth:6}));
                    var outs = clone(subflow.out);
                    //node.error("outs:" + util.inspect(outs, {depth:6}));
                    
                    // now give them unique ids, reconnect internal wires, and connect
                    // external wires
                    newids(node, subnodes, ins, outs);
                    
                    //node.error("ins:" + util.inspect(ins, {depth:6}));
                    //node.error("outs:" + util.inspect(outs, {depth:6}));

                    //node.error("new subnodes:" + util.inspect(subnodes));


                    // retain the subnodeinstance
                    var OrgSubflowInstance = nodes[a];
                    // remove original from list
                    nodes.splice(a, 1);
                    // add in our new nodes, else we won't find them in rewire
                    var newnodes2 = nodes.concat(subnodes);
                    f.nodes = newnodes2;
                    nodes = f.nodes;
                    l = nodes.length;

                    var subflowname = OrgSubflowInstance.name;
                    if (!subflowname || subflowname === "")
                        subflowname = subflow.name;
                    if (!subflowname || subflowname === "")
                        subflowname = "subflow";

                    // an input and output nodes
                    var inputnode = 
                        {
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
                    
                    
                    var outputnodetemplate = 
                        {
                            id: "", // so inputs are already routed
                            type: "function",
                            z: f.id,
                            name: subflowname + "-out",
                            func: "\nreturn msg;",
                            outputs: 1, // this is the count out outputs from this template
                            noerr: 0,
                            x: OrgSubflowInstance.x + 100,
                            y: OrgSubflowInstance.y,
                            wires: [] // empty to start
                        };
                    
                    var outputnodes = [];
                    // creat as many as we have 'outs', regardless of connection
                    for (var out = 0; out < outs.length; out++){
                        var output = clone(outputnodetemplate);
                        output.id = RED2.util.generateId();
                        output.name = output.name + (out+1);
                        // only try to connect if any.
                        if (OrgSubflowInstance.wires[out]){
                            output.wires.push(OrgSubflowInstance.wires[out]);
                        }
                        output.y = output.y + out * 40;
                        outputnodes.push(output);
                    }

                    
                    // add input and output nodes; so we can find then in the next bit
                    // only need input if it has any output
                    nodes.push(inputnode);

                    // if outputs are not connected, they will not exist...
                    newnodes2 = nodes.concat(outputnodes);
                    f.nodes = newnodes2;
                    nodes = f.nodes;
                    l = nodes.length;
                                        
                    // we will have a new id
                    var newsubflowid = subflow.id;
                    
                    // wire up input and outputs
                    
                    // output must get sent from all mentioned in outs
                    for (var out1 = 0; out1 < outs.length; out1 ++){
                        for (var outw = 0; outw < outs[out1].wires.length; outw++){
                            // the dest
                            var dest = outputnodes[out1].id;
                            var src = outs[out1].wires[outw].id;
                            var srcport = outs[out1].wires[outw].port;
                            
                            //node.error("outs "+out1+" wire "+outw+" dest "+dest+" src "+ src+":"+srcport);
                            
                            // if out connected to in, then do so.
                            if (src === newsubflowid){
                                //node.error("is subflow itself");
                                src = inputnode.id;
                                srcport = 0;
                            }
                            
                            // find src, and add our node as a dest
                            for (var srcnode = 0; srcnode < l; srcnode ++){
                                if (nodes[srcnode].id === src){
                                    while (!nodes[srcnode].wires[srcport]){
                                        nodes[srcnode].wires.push([]);
                                    }
                                    //node.error("found src at node "+srcnode);
                                    nodes[srcnode].wires[srcport].push(dest);
                                }
                            }
                        }
                    }

                    // input must send to all mentioned in ins
                    for (var inp = 0; inp < ins.length; inp ++){
                        for (var inpw = 0; inpw < ins[inp].wires.length; inpw++){
                            inputnode.wires[0].push(ins[inp].wires[inpw].id);
                        }
                    }

                    // if new input node has no output, then kill it
                    // by setting z bad, it will be filtered out.
                    // BUT it may be unconnected on inside, so best leave it here
                    //if (inputnode.wires.length == 0){
                    //    inputnode.z = 'xxx';
                    //}
                    
                    // zap the one we found, so we don't find it again
                    
                    //node.error("flatten kill subflow");
                    //nodes[a].z = "xxx";
                    //nodes[a].type = "xxx";
                    
                    foundone = true;
                    //node.error("done subflow");
                    
                    // must start again, as we've updated the nodes.
                    // will call back in from the start
                    break;
                }
            }
        }
        
        if (!foundone){
            //node.error("no more subflows found");
        }
        return foundone;
    }

    // parses a flow, and makes a new id 
    // for each id we come accross, correctly 
    // re-linking wiring
    function modifyflow( node, f, msg ){
        //node.error("in modify");
        if (!f.id){
            //find the first z which is NOT an id
            var l = f.nodes.length;
            for (var a = 0; a < l; a++){
                //if non-empty z
                //node.error("check " + f.nodes[a].z + " " + f.nodes[a].name);
                if (f.nodes[a].z && (f.nodes[a].z !== "")){
                    var found = false;
                    var z = f.nodes[a].z;
                    for (var b = 0; b < l; b++){
                        if (z === f.nodes[b].id){
                            //node.error("found at " + f.nodes[b].id + " " + f.nodes[b].name);
                            found = true;
                            break;
                        }
                    }
                    if (!found){
                        //node.error("z not an id");
                        f.id = z;
                        //node.error("z not an id");
                        //node.error("found flow id at node " + a + " " + f.nodes[a].name);
                        break;
                    }
                }
            }
        }
        
        if (f.id){
            //node.error("modify");

            var flowid = f.id;
            f.id = RED2.util.generateId();
            
            var nodes = f.nodes;        
            var l = nodes.length;
            for (var a = 0; a < l; a++){
                // first, modify owner of node.
                if (nodes[a].z === flowid){
                    nodes[a].z = f.id;
                }
                
                // config nodes normally have z = "", give them us
                // instead.
                // this means that they will be deleted when the flow is deleted.
                if (nodes[a].z === ""){
                    nodes[a].z = f.id;
                }
            }

            // for each subflow, flatten it.
            // call until we find no more; each iteration 
            // flattens one level
            //node.error("call flatten");
            var done = false;
            do {
                done = flattensubflows(node, f, f.id);
            } while (done);

            // f.nodes is changed in flatten...
            
            // generate new node ids,
            // and replace any of each old id with the new id 
            newids(node, f.nodes);
            
            // finally discard anything not marked with our z
            var ournodes = f.nodes.filter(function(onode){ 
                if((onode.z === f.id) && (!onode.type.startsWith("subflow:")) ){
                    return true;
                }
                });

            msg.payload = JSON.stringify(f);
                
            f.nodes = ournodes;
            
            msg.payload = msg.payload + JSON.stringify(f);
            
        } else {
            node.error("modify - no flow id found?");
        }

    };
    
    // save the current flow, or if msg.flowId, that flow, or 'all'
    function saveflow(n) {
        RED.nodes.createNode(this, n);
        this.name = n.name || '';
        this.path = n.path || '';
        this.enabled = n.enabled || false;
        this.exporttype = n.exporttype || 'original';
        var node = this;
        
        // call input in 100ms
        if (this.enabled){
            setTimeout( function() { node.emit("input",{}); }, 100 );
        }
        
        node.on('input', function (msg) {
            
            var pname = '';
            var pext = '.flow';
            var errs = [];
            var pathin = node.path;
            
            if (msg.filename){
                pathin = msg.filename;
            }

            var ppath = pathin;
            
            if (pathin.length < 1){
                err = 'no path set';
                errs.push(err);
                node.error("no path set" + err.toString(),msg); 
                msg.errs = errs;
                node.send(msg);
                return;
            } else {
                var endc = pathin.slice(-1);
                if ((endc !== '/') && (endc !== '\\')){
                    var parsed = fspath.parse(pathin);
                    pname = parsed.name;
                    pext = parsed.ext;
                    ppath = parsed.dir;
                    if (pext === ''){
                        pext = '.flow';
                    }
                }
            }

            var ids = [this.z];
            if (msg.flowId) { 
                ids = msg.flowId; 
            }
            
            var doall = false;
            var allnodes = RED2.nodes.getFlows().flows;
            
            if (ids === 'all'){
                ids = [];
                doall = true;
                // read all flow ids from whole of node-red
                for (var n = 0; n < allnodes.length; n++){
                    if (allnodes[n].type === 'tab'){
                        ids.push(allnodes[n].id);
                    }
                }
                
                // if we thought we had an exact name, but have multiple
                // flows, then reset and add a slash
                if (pname){
                    pname = '';
                    ppath = pathin + '/';
                }
                
            } else {
                if (!util.isArray(ids)){
                    ids = [ids];
                }
            }

            
            for (var i = 0; i < ids.length; i++){
                var id = ids[i];
                
                try {
                    var flowcomplete = getflow(id, node.exporttype);

                    var nodes = flowcomplete.nodes;
                    var name = flowcomplete.label;
                    
                    // if name is to be overridden
                    if (pname !== ''){
                        name = pname;
                    }
                    var ext = pext;
                    var path = ppath;
                    
                    var filename = fspath.join(path, name + ext);
                    var filespath = fspath.join(path, name);

                    switch (node.exporttype){
                        case 'addflow':
                            var json = JSON.stringify(flowcomplete, '', '\t');
                            break;
                        case 'clipboardexport':
                        case 'original':
                        default:
                            var json = JSON.stringify(flowcomplete.nodes, '', '\t');
                            break;
                    }
                    
                    
                    var writenodes = function(path, nodes){
                        var l = nodes.length;
                        for (var a = 0; a < l; a++){
                            var n = nodes[a];
                            if (n.type === 'function'){
                                var name = n.name;
                                if (name === ''){
                                    name = n.id;
                                }
                                var filename2 = fspath.join(path, name + '.js');
                    
                                try {
                                    fs.writeFileSync(filename2, n.func, {encoding:"utf8"});
                                } catch (err) {
                                    if (err.code === "ENOENT") {
                                        try{
                                            fs.ensureFileSync(filename2);
                                            fs.writeFileSync(filename2, n.func, {encoding:"utf8"});
                                        } catch (e) {
                                            errs.push(err.toString());
                                            node.error("writefail flow " + err.toString(),msg); 
                                        }
                                    }
                                }
                            }
                        }
                    };
                    
                    
                    try{
                        fs.writeFileSync(filename, json, {encoding:"utf8"});
                        writenodes(filespath, nodes);
                    } catch (err){
                        if (err) {
                            if (err.code === "ENOENT") {
                                try {
                                    fs.ensureFileSync(filename);
                                    fs.writeFileSync(filename, json, {encoding:"utf8"});
                                    writenodes(filespath, nodes);
                                } catch (err){
                                    if (err) { 
                                        errs.push(err.toString());
                                        node.error("createfail function " + err.toString(),msg); 
                                    }
                                }
                            } else { 
                                errs.push(err.toString());
                                node.error("writefail function " + err.toString(),msg); 
                            }
                        }
                    }
                    
                } catch (err) {
                    node.error(err.message);
                    // if we did not delete, always pass on input msg
                    // with err set
                    errs.push(err.toString());
                }
            }

            if (errs.length){
                msg.errs = errs;
            }
            // if we still exist, and want to pass the msg on...
            node.send(msg);
        });
    }
    RED.nodes.registerType("saveflow", saveflow);
    //console.log("registered saveflow");


    
    /////////////////////////////////////////////////
    // function gets a complete flow in the form {id:<id>, label:<label>, nodes:[ the nodes ]}
    // if exporttype is not 'original', then subflows and config nodes are included.
    // used by getflows node, and by saveflows node.
    function getflow(id, exporttype){
        exporttype = exporttype || 'addflow';
        var flow = RED2.nodes.getFlow(id);

        // copy the nodes array, as we may well want to add to it.
        var nodes = [];
        
        var nodes_map = {};
        // also note any subflows in use
        var subflow_map = {};
        var l = flow.nodes.length;
        for (var a = 0; a < l; a++){
            nodes_map[flow.nodes[a].id] = flow.nodes[a];
            if (undefined !== flow.nodes[a].subflow){
                subflow_map[flow.nodes[a].subflow] = 1;
            }
        }
        
        if (exporttype !== 'original')
            var globalnodes = RED2.nodes.getFlow('global');

        
        // add in subflows that we are using
        if ((exporttype !== 'original') && globalnodes.subflows){
            for (var c = 0; c < globalnodes.subflows.length; c++){
                var gsubflow = globalnodes.subflows[c];
                if (subflow_map[gsubflow.id] !== undefined){
                    // we've got a subflow which is in use.

                    // push parts of the subflow
                    var copied = clone(gsubflow);
                    delete copied.nodes;
                    delete copied.configs;
                    // don't add a subflow twice (I dont think the code above will give us it twice)
                    if (undefined === nodes_map[copied.id]){
                        nodes.push(copied);
                        nodes_map[copied.id] = copied;

                        // push all it's nodes as as they are
                        for (var n = 0; n < gsubflow.nodes.length; n++){
                            nodes.push(clone(gsubflow.nodes[n]));
                            // add a note of the id in the nodes_map
                            // so we can identify configs in use next
                            nodes_map[gsubflow.nodes[n].id] = gsubflow.nodes[n];
                        }
                        
                        // push all it's configs as as they are?
                        // - not for the moent - they should be picked up when we go through the global configs
                        //for (var n = 0; n < gsubflow.configs.length; n++){
                        //    nodes.push(gsubflow.configs[n]);
                        //}
                    }
                }
            }
        }
        

        // locate and push our tab node
        // sometimes clipboard shows this, normally not?
        if (0){
            if (exporttype){
                for (var n = 0; n < allnodes.length; n++){
                    //if (allnodes[n].type === 'tab')
                     //   console.log(util.inspect(allnodes[n]));
                    if (allnodes[n].id === id){
                        nodes.push(clone(allnodes[n]));
                        nodes_map[allnodes[n].id] = allnodes[n];
                        // there should only be one
                        break;
                    }
                }
            }
        }
        
        
        // push everything in our flow
        // (hopefully, we get the same order as a gui export)
        var l = flow.nodes.length;
        for (var a = 0; a < l; a++){
            flownode = clone(flow.nodes[a]);
            if (flownode.subflow){
                delete flownode.subflow;
            }
            nodes.push(flownode);
            nodes_map[flownode.id] = flownode;
        }


        // add in config nodes which reference any of our nodes in _users
        if ((exporttype !== 'original') && globalnodes.configs){
            for (var c = 0; c < globalnodes.configs.length; c++){
                var gnode = globalnodes.configs[c];
                if (gnode._users !== undefined){
                    for (var u = 0; u < gnode._users.length; u++){
                        if (undefined !== nodes_map[gnode._users[u]]){
                            //console.log("config used by " + gnode._users[u] + " = " + util.inspect(nodes_map[gnode._users[u]]));
                            // want to remove _users, and put it IN our flow
                            var copied = clone(gnode);
                            delete copied._users;
                            //copied.z = id;
                            // don't add a config node twice
                            if (undefined === nodes_map[copied.id]){
                                nodes.push(copied);
                                nodes_map[copied.id] = copied;
                            }
                        }
                    }
                }
            }
        }

        // add in any in-flow configs
        if (flow.configs){
            for (var c = 0; c < flow.configs.length; c++){
                var gnode = flow.configs[c];
                // don;t even check; it's in our flow.
                //if (gnode._users !== undefined){
                //    for (var u = 0; u < gnode._users.length; u++){
                //        if (undefined !== nodes_map[gnode._users[u]]){
                            //console.log("config used by " + gnode._users[u] + " = " + util.inspect(nodes_map[gnode._users[u]]));
                            // want to remove _users, and put it IN our flow
                            var copied = clone(gnode);
                            delete copied._users;
                            //copied.z = id;
                            // don't add a config node twice
                            if (undefined === nodes_map[copied.id]){
                                nodes.push(copied);
                                nodes_map[copied.id] = copied;
                            }
                //        }
                //    }
                //}
            }
        }
        
        var exportflow = { 
            id: id,
            label: flow.label,
            nodes: nodes
        };
        return exportflow;
    }

    

    // save the current flow, or if msg.flowId, that flow, or 'all'
    function getflows(n) {
        RED.nodes.createNode(this, n);
        this.name = n.name || '';
        var node = this;
        
        node.on('input', function (msg) {
            var flows = [];
            msg.thisflow = node.z;
            
            if (msg.id !== undefined){
                try{
                    msg.payload = getflow(msg.id);
                } catch (e) {
                    delete msg.payload;
                    msg.err = 'could not get flow ' + util.inspect(msg.id) + ' ' + util.inspect(e);
                }
            } else {
                try{
                    // read all flow ids from whole of node-red
                    var allnodes = RED2.nodes.getFlows().flows;
                    for (var n = 0; n < allnodes.length; n++){
                        if (allnodes[n].type === 'tab'){
                            // duplicate so we don't give ability to modify
                            var flow = {id:allnodes[n].id, label:allnodes[n].label};
                            flows.push(flow);
                        }
                    }
                    
                    msg.payload = flows;
                } catch (e) {
                    delete msg.payload;
                    msg.err = 'could not get flows ' + util.inspect(e);
                }
            }
            node.send(msg);
        });
    }
    RED.nodes.registerType("getflows", getflows);
    //console.log("registered getflows");

    
};