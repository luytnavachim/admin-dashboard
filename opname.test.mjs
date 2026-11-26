// Test voor de video van de werkopname: node opname.test.mjs (slaat over zonder ffmpeg)
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { spawnSync } from "node:child_process";
import { maakVideo } from "./opname.mjs";
let fout = 0; const ok = (c, m) => { console.log((c ? "ok  " : "FOUT") + " " + m); if (!c) fout++; };
const map = fs.mkdtempSync(path.join(os.tmpdir(), "opname-test-"));
ok(maakVideo(map, null).fout.includes("ffmpeg"), "zonder ffmpeg een nette melding");
const ff = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].find(p => fs.existsSync(p));
ok(maakVideo(map, ff || "/x").fout !== undefined, "zonder beelden een melding");
if (ff) {
  for (const n of [1, 2, 4]) spawnSync(ff, ["-loglevel", "error", "-f", "lavfi", "-i", `color=c=blue:s=320x200`, "-frames:v", "1", path.join(map, String(n).padStart(5, "0") + ".jpg")]);
  const v = maakVideo(map, ff);
  ok(v.klaar && fs.existsSync(path.join(map, "video.mp4")), "video gemaakt uit beelden met een gat in de nummering");
  ok(v.beelden === 3 && JSON.parse(fs.readFileSync(path.join(map, "video.json"), "utf8")).klaar, "video.json klopt");
} else console.log("ffmpeg ontbreekt: videotest overgeslagen");
fs.rmSync(map, { recursive: true, force: true });
process.exit(fout ? 1 : 0);
