# node-red-contrib-adddelflow
Node-red nodes for manipulating flows using the RED nodejs API

##Functions
* addflow - adds a flow found in msg.payload (either a json or a javascript structure).
* delflow - delete a flowid or the current flow.
* saveflow - save a flowid or the current flow or all flows, extracting content of 'function' nodes into files
* getflows - retrieve a list of the current flows, returning an array of {id,label}

Note: 0.16.2 with it's new 'difference' detection does not play nice with addflow/delflow from a UI perspective.  Updates in 0.17 resolves this with the ability to delpoy regardless of server changes.
Note: as this uses private apis in RED, there's no guarantee of continued correct operation as NR get's enhanced.

License: MIT
