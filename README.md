# node-red-contrib-flowman
Node-red nodes for manipulating flows using the RED nodejs API

##Functions
* addflow - adds a flow found in msg.payload (either a json or a javascript structure).
* delflow - delete a flowid or the current flow.
* saveflow - save a flowid or the current flow or all flows, extracting content of 'function' nodes into files
* getflows - retrieve a list of the current flows, returning an array of {id,label}, or if msg.id is set, retrieve a specific flow in the form needed for 'addflow'.

Note: 0.16.2 with it's new 'difference' detection does not play nice with addflow/delflow from a UI perspective.  Updates in 0.17 resolves this with the ability to delpoy regardless of server changes.
Note: as this uses private apis in RED, there's no guarantee of continued correct operation as NR get's enhanced.

Updates:
0.0.7:
saves config nodes which were already part of the flow (i.e. not in global).  Previous versions skipped these (in saveflow and getflows)
0.0.6:
fixed a bug in saveflow ('exporttype undefined')
0.0.5:
removed some console.log()
0.0.4:
saveflow: Added Export style dropdown option on saveflow, to allow the output to contain config/subflows, and to allow matching of addflow style or 'export from browser' style files.
getflows: added ability to get a complete flow by setting msg.id, returning an object suitable for use with addflow.
Reviewed and updated displayed node info.

License: MIT
