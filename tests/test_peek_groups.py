import json
import os
import shutil
import subprocess
import unittest


@unittest.skipUnless(shutil.which("node"), "node is needed to test Peek grouping")
class PeekGroups(unittest.TestCase):
    def test_groups_only_promoted_tabs_and_preserves_existing_stack(self):
        script = r'''
const fs = require("fs"), vm = require("vm");
let source = {id:1,windowId:3,pinned:false,vivExtData:JSON.stringify({workspaceId:7,ext_id:"source"})};
let dest = {id:2,windowId:3,pinned:false,vivExtData:JSON.stringify({workspaceId:7})};
let moveCalls = [], events = [];
const peek = {webviews:new Map(),getOwningTabId:d=>d?.ownerTabId,createParallelTab:async()=>null,ensureParallelTab:async()=>({tab:dest}),openNewTab:async function(id){await this.ensureParallelTab(id,{}); this.webviews.delete(id)}};
globalThis.window={ArcPeekDebug:peek,dispatchEvent:e=>events.push(e.type)};
globalThis.CustomEvent=class {constructor(type,opts){this.type=type;this.detail=opts?.detail}};
globalThis.chrome={tabs:{get:async id=>id===1?source:id===2?dest:null}};
globalThis.vivaldi={tabsPrivate:{move:async options=>{moveCalls.push(options); const group=JSON.parse(source.vivExtData).group||"stack"; source.vivExtData=JSON.stringify({...JSON.parse(source.vivExtData),group});dest.vivExtData=JSON.stringify({...JSON.parse(dest.vivExtData),group});return {success:true};}}};
vm.runInThisContext(fs.readFileSync(process.argv[1],"utf8"));
(async()=>{
 peek.webviews.set("first",{ownerTabId:1});await peek.openNewTab("first",true);
 const created=moveCalls[0];
 dest.vivExtData=JSON.stringify({workspaceId:7});peek.webviews.set("second",{ownerTabId:1});await peek.openNewTab("second",true);
 const joined=moveCalls[1];
 dest.vivExtData=JSON.stringify({workspaceId:99});peek.webviews.set("third",{ownerTabId:1});await peek.openNewTab("third",true);
 console.log(JSON.stringify({created,joined,count:moveCalls.length,events}));
})();
'''
        path = os.path.join(os.path.dirname(__file__), "..", "src", "optional", "peek-groups.js")
        result = subprocess.run(["node", "-e", script, path], capture_output=True, text=True, check=True)
        out = json.loads(result.stdout)
        self.assertEqual(out["created"]["tabIds"], [1, 2])
        self.assertIn("create-new-group", out["created"]["tweaks"])
        self.assertEqual(out["joined"]["tabIds"], [2])
        self.assertIn("into", out["joined"]["tweaks"])
        self.assertEqual(out["count"], 2)
        self.assertEqual(out["events"].count("vm-refresh-sidebar"), 2)
        self.assertIn("vm-toast", out["events"])


if __name__ == "__main__":
    unittest.main()
