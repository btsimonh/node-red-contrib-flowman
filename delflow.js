var util = require('util');
var RED2 = require('node-red');

module.exports = function (RED) {

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
                node.error("delete flow " + id + " inhibited");
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
            var flow = {}
            if (typeof msg.payload == 'string'){
                flow = JSON.parse(msg.payload);
            } else {
                flow = msg.payload;
            }
            
            if (!Array.isArray(flow.nodes)){
                node.error("did not addFlow - no .nodes found");
                msg.err = "did not addFlow - no .nodes found";
                return msg;
            }

            if (typeof flow.label != 'string'){
                node.error("did not addFlow - no .label found");
                msg.err = "did not addFlow - no .label found";
                return msg;
            }

            
            try {
                modifyflow(flow);
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

    
    // parses a flow, and makes a new id 
    // for each id we come accross, correctly 
    // re-linking wiring
    function modifyflow( f ){
        if (!f.id){
            if (f.nodes[0].z){
                f.id = f.nodes[0].z;
            }
        }
        
        if (f.id){
            var flowid = f.id;
            f.id = RED2.util.generateId();
            
            var nodes = f.nodes;        
            var l = nodes.length;
            for (var a = 0; a < l; a++){
                // first, modify owner of node.
                if (nodes[a].z == flowid){
                    nodes[a].z = f.id;
                }
            }
    
            for (var a = 0; a < l; a++){
                // now for each wire.
                var orgnodeid = nodes[a].id;
                nodes[a].id = RED2.util.generateId();
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
                }
            }
        }
    }
    
};