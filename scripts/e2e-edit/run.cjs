const { spawnSync } = require('child_process');
const electron = require(require('node:path').resolve(__dirname, '..', '..', 'node_modules', 'electron'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(electron, [__dirname + '/e2e.cjs', ...process.argv.slice(2)], { env, encoding: 'utf8', timeout: 240000 });
console.log(r.stdout);
console.log((r.stderr || '').split('\n').filter((l) => !/DevTools|dbus|GPU|gpu|Autofill|ERROR:CONSOLE/.test(l)).slice(-15).join('\n'));
