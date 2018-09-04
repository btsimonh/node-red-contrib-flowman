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
0.0.11:
add disabled to addFlow and getFlow - needs enabling in NR API.
0.0.10:
allow msg.filename to specify path or filename for saveflows.
0.0.9:
improve error handling for addflow/delflow; in 0.0.8 it was possible to send two delflows for the same flow, and this would result in NR raising a valid exception of 'flow not present', but this would then terminate the queue processing, which would never again be started.
Now, when such an exception is raised, the WHOLE queue will be emptied, just so that it's not stuck in a state where it can't be started (it's only started if add/del creates the first entry on the queue).
This is not ideal - would be better to continue the queue after the exception, or to remove entries from the queue which have the same id as the id just deleted so the error never occurs, or to 'getflows' and just not try to delete if the id is not present.
0.0.8:
addflow and delflow are now serialised, so that multiple adds/deletes do not interfere with each other (but still may interfere with a web delpoy).  Both addflow and delfow will now only pass on the msg once the add/del has been completed (async style).
Note: each add/del WILL cause a save of the flows file.
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
