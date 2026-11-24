# node-red-contrib-flowman
Node-red nodes for manipulating flows using the RED nodejs API

## Functions
* addflow - adds a flow found in msg.payload (either a json or a javascript structure).
* delflow - delete a flowid or the current flow.
* saveflow - save a flowid or the current flow or all flows, extracting content of 'function' nodes into files
* getflows - retrieve a list of the current flows, returning an array of {id,label}, or if msg.id is set, retrieve a specific flow in the form needed for 'addflow'.

Requires Node-RED 1.0.2 or later (tested with 1.0.2 and 5.0.0), and Node.js 12 or later.

Note: as this uses private apis in RED, there's no guarantee of continued correct operation as NR get's enhanced.

**Security:** these nodes can add flows (including function nodes, i.e. arbitrary code), delete flows, and write files anywhere the Node-RED process can. Do not wire them to messages that can be influenced from outside (http in, mqtt, websocket, etc.) unless you fully trust and validate that input.

## Updates:
* 0.0.13:
  * addflow/delflow: rewrote the shared add/delete queue. A failed add or delete now only fails that one request (passing on the msg with `msg.err` set); it no longer empties the queue, or leaves it permanently stuck (which happened if the very first queued request failed, e.g. deleting a flow that does not exist).
  * addflow: `msg.payload` is now passed on unchanged (it was being replaced with debug output). Invalid input (bad JSON, missing .nodes/.label, missing flow id, missing subflow definition) now passes on the msg with `msg.err`, rather than dropping it.
  * addflow: config nodes with no `z` are now included in the new flow. A node's `name`/`type` is no longer rewritten if it happens to equal a node id.
  * getflows/saveflow: flow `info` and `env` (if any) are included in the export, and runtime-only properties (`subflow`, `_users`, `credentials`) are removed.
  * getflows/saveflow: subflows used inside subflows, and config nodes inside subflows, are now included in 'addflow' and 'clipboard' exports.
  * saveflow: flow labels and function names are made safe for use as file names; all file write errors are reported in `msg.errs`; function node On Start/On Stop code is saved as `<name>.initialize.js`/`<name>.finalize.js`; no longer depends on fs-extra.
  * `msg.err` from addflow/delflow is now always a string.
  * example renamed to `.json` so it appears in the Node-RED Import > Examples menu.
  * package: declares Node-RED (>=1.0.2) and Node.js (>=12) versions; only publishes the needed files.
* 0.0.12:
add id updates for ids in arrays of keys on nodes. Should fix status and catch nodes?
* 0.0.11:
add disabled to addFlow and getFlow - needs enabling in NR API.
* 0.0.10:
allow msg.filename to specify path or filename for saveflows.
* 0.0.9:
improve error handling for addflow/delflow; in 0.0.8 it was possible to send two delflows for the same flow, and this would result in NR raising a valid exception of 'flow not present', but this would then terminate the queue processing, which would never again be started.
Now, when such an exception is raised, the WHOLE queue will be emptied, just so that it's not stuck in a state where it can't be started (it's only started if add/del creates the first entry on the queue).
This is not ideal - would be better to continue the queue after the exception, or to remove entries from the queue which have the same id as the id just deleted so the error never occurs, or to 'getflows' and just not try to delete if the id is not present.
* 0.0.8:
addflow and delflow are now serialised, so that multiple adds/deletes do not interfere with each other (but still may interfere with a web delpoy).  Both addflow and delfow will now only pass on the msg once the add/del has been completed (async style).
Note: each add/del WILL cause a save of the flows file.
* 0.0.7:
saves config nodes which were already part of the flow (i.e. not in global).  Previous versions skipped these (in saveflow and getflows)
* 0.0.6:
fixed a bug in saveflow ('exporttype undefined')
* 0.0.5:
removed some console.log()
* 0.0.4:
saveflow: Added Export style dropdown option on saveflow, to allow the output to contain config/subflows, and to allow matching of addflow style or 'export from browser' style files.
getflows: added ability to get a complete flow by setting msg.id, returning an object suitable for use with addflow.
Reviewed and updated displayed node info.

License: MIT
