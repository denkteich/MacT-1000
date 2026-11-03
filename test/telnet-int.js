const net = require('net'); const assert = require('assert');
const { TelnetSession, consts: C } = require('../src/telnet');
const got = [];
const srv = net.createServer(s => {
  s.on('data', d => got.push(...d));
  s.write(Buffer.from([C.IAC, C.DO, C.OPT_TTYPE, C.IAC, C.DO, C.OPT_NAWS, C.IAC, C.WILL, C.OPT_ECHO, C.IAC, C.SB, C.OPT_TTYPE, 1, C.IAC, C.SE]));
  s.write('Username: ');
}).listen(0, () => {
  const out = [];
  const sess = new TelnetSession({ host: '127.0.0.1', port: srv.address().port, username: 'admin', autoLogin: true }, { cols: 120, rows: 40 }, (t, p) => { if (t === 'data') out.push(p); });
  setTimeout(() => {
    sess.resize(100, 30);
    setTimeout(() => {
      const b = Buffer.from(got);
      const hex = b.toString('hex');
      assert.ok(hex.includes('fffb18'), 'WILL TTYPE');
      assert.ok(hex.includes('fffa1800' + Buffer.from('XTERM-256COLOR').toString('hex') + 'fff0'), 'TTYPE IS');
      assert.ok(hex.includes('fffa1f00780028fff0'), 'NAWS 120x40');
      assert.ok(hex.includes('fffa1f0064001efff0'), 'NAWS 100x30');
      assert.ok(hex.includes('fffd01'), 'DO ECHO');
      assert.ok(b.toString('latin1').includes('admin\r\n'), 'Auto-Login');
      assert.ok(out.join('').includes('Username: '));
      console.log('Telnet-Integrationstest bestanden');
      sess.kill(); srv.close();
    }, 200);
  }, 300);
});
