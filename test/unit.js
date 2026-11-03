const assert = require('assert');
const { TelnetParser, consts: C } = require('../src/telnet');
const { parseQuick } = require('../renderer/util');
const { Layout } = require('../renderer/layout');
const { splitArgs, buildSshArgs } = require('../src/sessions');

// Telnet-Parser: Daten + Verhandlung, über Chunk-Grenzen
const p = new TelnetParser();
let r = p.feed(Buffer.from([0x41, C.IAC, C.DO]));
assert.strictEqual(r.data.toString(), 'A'); assert.strictEqual(r.events.length, 0);
r = p.feed(Buffer.from([C.OPT_NAWS, 0x42, C.IAC, C.IAC, C.IAC, C.SB, C.OPT_TTYPE, 1, C.IAC, C.SE, 0x43]));
assert.strictEqual(r.data.toString('latin1'), 'B\xffC');
assert.deepStrictEqual(r.events[0], { type: 'neg', cmd: C.DO, opt: C.OPT_NAWS });
assert.strictEqual(r.events[1].type, 'sb'); assert.strictEqual(r.events[1].data[0], 1);

// Quick Connect
assert.deepStrictEqual(parseQuick('admin@10.0.0.1'), { type: 'ssh', port: 22, username: 'admin', host: '10.0.0.1' });
assert.deepStrictEqual(parseQuick('ssh -p 2222 root@srv'), { type: 'ssh', port: 2222, username: 'root', host: 'srv' });
assert.deepStrictEqual(parseQuick('srv:2200'), { type: 'ssh', port: 2200, host: 'srv' });
assert.strictEqual(parseQuick('telnet 10.1.1.1 2001').port, 2001);
assert.strictEqual(parseQuick('telnet 10.1.1.1:2001').port, 2001);
assert.strictEqual(parseQuick('10.1.1.1:23').type, 'telnet');
assert.strictEqual(parseQuick('/dev/cu.usbserial-1 115200').baudRate, 115200);
assert.strictEqual(parseQuick('serial /dev/cu.x').baudRate, 9600);
assert.deepStrictEqual(parseQuick('rdp admin@win01:3390'), { type: 'rdp', host: 'win01', port: 3390, username: 'admin' });
assert.strictEqual(parseQuick('ssh -o StrictHostKeyChecking=no h').extraArgs, '-o StrictHostKeyChecking=no');
assert.strictEqual(parseQuick('local').type, 'local');

// Layout
let root = Layout.leaf('a');
root = Layout.split(root, 'a', 'b', 'row');
root = Layout.split(root, 'b', 'c', 'column');
assert.deepStrictEqual(Layout.leaves(root), ['a', 'b', 'c']);
root = Layout.split(root, 'a', 'z', 'row', true);
assert.deepStrictEqual(Layout.leaves(root), ['z', 'a', 'b', 'c']);
root = Layout.remove(root, 'b');
assert.deepStrictEqual(Layout.leaves(root), ['z', 'a', 'c']);
const g = Layout.grid(['1', '2', '3', '4', '5']);
assert.deepStrictEqual(Layout.leaves(g), ['1', '2', '3', '4', '5']);
const eq = Layout.equalize(Layout.split(Layout.split(Layout.leaf('x'), 'x', 'y', 'row'), 'y', 'w', 'row'));
assert.ok(Math.abs(eq.ratio - 1 / 3) < 1e-9);
assert.strictEqual(Layout.remove(Layout.leaf('q'), 'q'), null);

// ssh-Argumente
assert.deepStrictEqual(splitArgs(`-o "ProxyCommand=ssh -W %h:%p jump" -v`), ['-o', 'ProxyCommand=ssh -W %h:%p jump', '-v']);
assert.deepStrictEqual(buildSshArgs({ host: 'h', port: 2222, username: 'u', jumpHost: 'j', shareConnection: false, forwards: [{ type: 'L', spec: '8080:localhost:80' }] }),
  ['-p', '2222', '-l', 'u', '-J', 'j', '-L', '8080:localhost:80', 'h']);
assert.ok(buildSshArgs({ host: 'h' }).includes('ControlMaster=auto'));

// scp-Hilfsfunktionen
const { parseLs, parseProgress, remoteSpec, commonOpts } = require('../src/scp');
const ls = parseLs(`total 20
drwxr-xr-x  5 root root 4096 Oct 31 10:00 .
drwxr-xr-x 20 root root 4096 Jan  1  2025 ..
-rw-r--r--  1 harald staff 12345 Oct 31 09:12 datei mit leer.txt
drwxr-xr-x  2 harald staff   64 Sep  3  2024 Ordner
-rw-r--r--@ 1 harald staff  10 Oct 31 09:12 .bashrc
crw-rw-rw-  1 root root 1, 3 Oct 31 10:00 null
-rw-r--r--    1 root     root          1024 Jan  1 00:00 busybox.cfg`);
assert.deepStrictEqual(ls.map(e => e.name), ['Ordner', '.bashrc', 'busybox.cfg', 'datei mit leer.txt', 'null']);
assert.strictEqual(ls.find(e => e.name === 'datei mit leer.txt').size, 12345);
assert.strictEqual(ls[0].type, 'dir');
assert.strictEqual(ls.find(e => e.name === 'null').type, 'other');
assert.deepStrictEqual(parseProgress('big.iso                                        45%   45MB  11.2MB/s   00:04 ETA'),
  { file: 'big.iso', percent: 45, size: '45MB', speed: '11.2MB/s', eta: '00:04' });
assert.strictEqual(parseProgress('mein file.txt 100%   10     0.1KB/s   00:00').percent, 100);
assert.strictEqual(parseProgress('Permission denied'), null);
assert.strictEqual(remoteSpec({ host: 'h' }, '/a b'), 'h:/a b');
assert.strictEqual(remoteSpec({ host: 'h', scpLegacy: true }, "/a'b"), "h:'/a'\\''b'");
assert.strictEqual(remoteSpec({ host: 'fe80::1' }, '/x'), '[fe80::1]:/x');
const co = commonOpts({ host: 'h', port: 2200, username: 'u', extraArgs: '-o StrictHostKeyChecking=no -v -oLogLevel=ERROR' });
assert.ok(co.includes('Port=2200') && co.includes('User=u') && co.includes('StrictHostKeyChecking=no') && co.includes('LogLevel=ERROR') && !co.includes('-v'));
console.log('Alle Unit-Tests bestanden');
