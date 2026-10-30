import json
import os
import shutil
import subprocess
import unittest


@unittest.skipUnless(shutil.which("node"), "node is needed to test Peek motion")
class PeekMotion(unittest.TestCase):
    def test_motion_overrides_both_geometries_and_respects_reduced_motion(self):
        script = r'''
const fs = require("fs"), vm = require("vm");
let reduced = false;
const rect = { openingKeyframes: [{left:"100px",top:"50px",width:"10px",height:"10px",borderRadius:"4px",opacity:1},{left:"0px",top:"0px",width:"400px",height:"300px",borderRadius:"12px",opacity:1}], closingKeyframes: [{left:"0px",top:"0px",width:"400px",height:"300px",borderRadius:"12px",opacity:1},{left:"100px",top:"50px",width:"10px",height:"10px",borderRadius:"4px",opacity:1}] };
const peek = { getGlanceDuration: () => 260, getPanelScaleMotionGeometry: () => ({panelTranslateX:100,panelTranslateY:50,uniformScale:0.1,sourceRadius:"4px",finalRadius:"12px"}), getPanelRectMotionGeometry: () => rect };
globalThis.window = { ArcPeekDebug: peek, matchMedia: () => ({ matches: reduced }) };
vm.runInThisContext(fs.readFileSync(process.argv[1], "utf8"));
const scale = peek.getPanelScaleMotionGeometry(), geometry = peek.getPanelRectMotionGeometry();
const result = { durations:[peek.getGlanceDuration("opening"),peek.getGlanceDuration("closing")], installed:!!peek.__vivarcMotion, scaleStart:scale.openingKeyframes[0].transform, scaleEnd:scale.openingKeyframes.at(-1).transform, widths:geometry.openingKeyframes.map(f => parseFloat(f.width)), closeWidths:geometry.closingKeyframes.map(f => parseFloat(f.width)) };
reduced = true; result.reduced = peek.getGlanceDuration("opening");
console.log(JSON.stringify(result));
'''
        path = os.path.join(os.path.dirname(__file__), "..", "src", "optional", "peek-motion.js")
        result = subprocess.run(["node", "-e", script, path], capture_output=True, text=True, check=True)
        out = json.loads(result.stdout)
        self.assertTrue(out["installed"])
        self.assertEqual(out["durations"], [300, 240])
        self.assertEqual(out["reduced"], 1)
        self.assertEqual(out["scaleStart"], "translate(100px, 50px) scale(0.1)")
        self.assertEqual(out["scaleEnd"], "translate(0px, 0px) scale(1)")
        self.assertEqual((out["widths"][0], out["widths"][-1]), (10, 400))
        self.assertEqual(out["widths"], sorted(out["widths"]))
        self.assertEqual(out["closeWidths"], sorted(out["closeWidths"], reverse=True))


if __name__ == "__main__":
    unittest.main()
