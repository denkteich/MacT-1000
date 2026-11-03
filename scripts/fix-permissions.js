// node-pty liefert spawn-helper teilweise ohne Ausführungsrecht aus -> "posix_spawnp failed"
const fs = require('fs');
const path = require('path');
for (const arch of ['darwin-arm64', 'darwin-x64']) {
  const p = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds', arch, 'spawn-helper');
  try { fs.chmodSync(p, 0o755); } catch (_) {}
}
const built = path.join(__dirname, '..', 'node_modules', 'node-pty', 'build', 'Release', 'spawn-helper');
try { fs.chmodSync(built, 0o755); } catch (_) {}
