// spawn-helper von node-pty ausführbar machen (sonst "posix_spawnp failed")
const fs = require('fs'); const path = require('path');
exports.default = async (ctx) => {
  const res = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty');
  for (const sub of ['prebuilds/darwin-arm64/spawn-helper', 'prebuilds/darwin-x64/spawn-helper', 'build/Release/spawn-helper']) {
    try { fs.chmodSync(path.join(res, sub), 0o755); } catch (_) {}
  }
};
