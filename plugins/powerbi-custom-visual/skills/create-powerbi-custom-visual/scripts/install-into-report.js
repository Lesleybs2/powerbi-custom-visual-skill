// Installs a packaged visual into a PBIR report folder, the same way Power BI Desktop's
// "Import a visual from a file" does: CustomVisuals/<guid>/{package.json,resources/<guid>.pbiviz.json}
// plus a CustomVisual entry in definition/report.json. Re-running upgrades the copy in place.
//
// usage: node scripts/install-into-report.js <path-to-.Report-dir> [path-to-.pbiviz]
// needs: npm i -D adm-zip
// Refuses while Power BI Desktop is running: Desktop rewrites CustomVisuals/ from memory on every save
// and would silently undo the install.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const AdmZip = require("adm-zip");

const [, , reportDir, pbivizArg] = process.argv;
if (!reportDir) { console.error("usage: node scripts/install-into-report.js <Report dir> [file.pbiviz]"); process.exit(1); }

if (process.platform === "win32") {
    const running = execSync('tasklist /FI "IMAGENAME eq PBIDesktop.exe" /NH', { encoding: "utf8" });
    if (/PBIDesktop\.exe/i.test(running)) { console.error("Power BI Desktop is open: save, close it, then run this again."); process.exit(1); }
}

// Newest build by write time, not by name: as text, 2.9.0 sorts after 2.10.0.
const distDir = path.join(__dirname, "..", "dist");
const pbiviz = pbivizArg || fs.readdirSync(distDir).filter(f => f.endsWith(".pbiviz")).map(f => path.join(distDir, f))
    .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs).pop();
if (!pbiviz || !fs.existsSync(pbiviz)) { console.error("no .pbiviz found; run `npm run package` first"); process.exit(1); }

const zip = new AdmZip(pbiviz);
const pkg = JSON.parse(zip.readAsText("package.json"));
const guid = pkg.visual.guid;
const target = path.join(reportDir, "CustomVisuals", guid);
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
zip.extractAllTo(target, true);

const reportJsonPath = path.join(reportDir, "definition", "report.json");
const report = JSON.parse(fs.readFileSync(reportJsonPath, "utf8"));
report.resourcePackages = (report.resourcePackages || []).filter(p => !(p.type === "CustomVisual" && p.name === guid));
report.resourcePackages.push({
    name: guid,
    type: "CustomVisual",
    items: [{ name: `${guid}.pbiviz.json`, path: `${guid}.pbiviz.json`, type: "CustomVisualMetadata" }],
});
fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2));
console.log(`installed ${path.basename(pbiviz)} (v${pkg.visual.version}) -> ${target}\nvisualType for visual.json: ${guid}`);
