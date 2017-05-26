
module.exports = function (RED) {
    var fs = require("fs-extra");
    var fspath = require("path");
    var util = require('util');
    var RED2 = require('node-red');

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
                try {
                    setTimeout(function(){
                        try {
                            RED2.nodes.removeFlow(id); 
                            node.log("deleted flow " + id);
                        } catch (e) {
                            node.error("failed to delete flow " + id + " " + util.inspect(e));
                            // if we did not delete, always pass on input msg
                            // with err set
                            msg.err = e;
                            outputmsg = true;
                        }
                        }, 1);
                } catch (err) {
                    node.error(err.message);
                    // if we did not delete, always pass on input msg
                    // with err set
                    msg.err = err;
                    outputmsg = true;
                }
            } else {
                node.warn("delete flow " + id + " inhibited");
                msg.err = "delete flow " + id + " inhibited";
            }

            // if we still exist, and want to pass the msg on...
            if (outputmsg){
                node.send(msg);
            }
        });
    }
    RED.nodes.registerType("delflow", delflow);

    
    
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
                var newflowidpromise = RED2.nodes.addFlow(flow);

                newflowidpromise.then( function(newflowid){
                    msg.flowId = newflowid;
                    node.send(msg);
                }).catch(function(){
                    node.error("did not addFlow?");
                    msg.err = "did not addFlow?";
                    node.send(msg);
                });
            } catch (err) {
                node.error(err.message);
                msg.err = "exception: did not addFlow";
                node.send(msg);
            }
            
            // don't return anything, as msgs may be sent from promise.
        });
    }
    RED.nodes.registerType("addflow", addflow);

    
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
        var node = this;
        
        // call input in 100ms
        if (this.enabled){
            setTimeout( function() { node.emit("input",{}); }, 100 );
        }
        
        node.on('input', function (msg) {
            
            var pname = '';
            var pext = '.flow';
            var ppath = node.path;
            var errs = [];
            
            if (node.path.length < 1){
                err = 'no path set';
                errs.push(err);
                node.error("no path set" + err.toString(),msg); 
                msg.errs = errs;
                node.send(msg);
                return;
            } else {
                var endc = node.path.slice(-1);
                if ((endc !== '/') && (endc !== '\\')){
                    var parsed = fspath.parse(node.path);
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
            
            if (ids === 'all'){
                ids = [];
                doall = true;
                // read all flow ids from whole of node-red
                var allnodes = RED2.nodes.getFlows().flows;
                for (var n = 0; n < allnodes.length; n++){
                    if (allnodes[n].type === 'tab'){
                        ids.push(allnodes[n].id);
                    }
                }
                
                // if we thought we had an exact name, but have multiple
                // flows, then reset and add a slash
                if (pname){
                    pname = '';
                    ppath = node.path + '/';
                }
                
            } else {
                if (!util.isArray(ids)){
                    ids = [ids];
                }
            }
            
            for (var i = 0; i < ids.length; i++){
                var id = ids[i];
                
                try {
                    var flow = RED2.nodes.getFlow(id);

                    var name = flow.label;
                    
                    // if name is to be overridden
                    if (pname !== ''){
                        name = pname;
                    }
                    var ext = pext;
                    var path = ppath;
                    
                    var filename = fspath.join(path, name + ext);
                    var filespath = fspath.join(path, name);
                    var nodes = flow.nodes;        
                    var json = JSON.stringify(nodes, '', '\t');
                    
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
    

    // save the current flow, or if msg.flowId, that flow, or 'all'
    function getflows(n) {
        RED.nodes.createNode(this, n);
        this.name = n.name || '';
        var node = this;
        
        node.on('input', function (msg) {
            var flows = [];
            
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
            node.send(msg);
        });
    }
    RED.nodes.registerType("getflows", getflows);

    
};