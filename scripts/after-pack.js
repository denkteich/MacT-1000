// macOS: spawn-helper von node-pty ausführbar machen (sonst "posix_spawnp failed")
// Windows: Programmsymbol und Versionsinfo der .exe setzen (ohne Wine, per resedit)
const fs = require('fs'); const path = require('path');
exports.default = async (ctx) => {
  const name = ctx.packager.appInfo.productFilename;
  if (ctx.electronPlatformName === 'win32') {
    const ResEdit = require('resedit');
    const exePath = path.join(ctx.appOutDir, `${name}.exe`);
    const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
    const res = ResEdit.NtExecutableResource.from(exe);
    const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico')));
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
    const gid = groups.length ? groups[0].id : 1; const glang = groups.length ? groups[0].lang : 1033;
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, glang, ico.icons.map(i => i.data));
    const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
    const v = ctx.packager.appInfo.version.split('.').map(Number);
    vi.setFileVersion(v[0] || 0, v[1] || 0, v[2] || 0, 0, 1033);
    vi.setProductVersion(v[0] || 0, v[1] || 0, v[2] || 0, 0, 1033);
    const langs = vi.getAllLanguagesForStringValues();
    for (const l of (langs.length ? langs : [{ lang: 1033, codepage: 1200 }])) {
      vi.setStringValues(l, {
        ProductName: 'MacT-1000', FileDescription: 'MacT-1000 Terminal', CompanyName: 'Harald Thomas',
        LegalCopyright: 'Copyright © 2026 Harald Thomas', OriginalFilename: `${name}.exe`, InternalName: 'MacT-1000',
        FileVersion: ctx.packager.appInfo.version, ProductVersion: ctx.packager.appInfo.version
      });
    }
    vi.outputToResourceEntries(res.entries);
    res.outputResource(exe);
    fs.writeFileSync(exePath, Buffer.from(exe.generate()));
    return;
  }
  const res = path.join(ctx.appOutDir, `${name}.app`, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty');
  for (const sub of ['prebuilds/darwin-arm64/spawn-helper', 'prebuilds/darwin-x64/spawn-helper', 'build/Release/spawn-helper']) {
    try { fs.chmodSync(path.join(res, sub), 0o755); } catch (_) {}
  }
  // Kommandozeilen-Werkzeug ausführbar machen
  try { fs.chmodSync(path.join(ctx.appOutDir, `${name}.app`, 'Contents', 'Resources', 'bin', 'mact1000'), 0o755); } catch (_) {}
};
