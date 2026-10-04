/*! Rendra IDE v1.7.0 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Environment setup: checks and installs the tools the DevCode tab builds on.
//   Git (Git Bash on Windows) · RTK (token-saving CLI proxy for Claude Code) · WSL (Windows only)
// Plain Node (no Electron), shared by the app's first-run setup and `npm run setup`.
// Works on Windows, macOS and Linux; every install asks the user first.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { swapBinary } = require('./rtk-install');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const HOME = os.homedir();
const BIN_DIR = path.join(HOME, '.local', 'bin');
const RTK_NAME = IS_WIN ? 'rtk.exe' : 'rtk';
const RTK_BIN = path.join(BIN_DIR, RTK_NAME);
const PROGRAM_FILES = process.env.ProgramFiles || 'C:\\Program Files';
const UA = { 'User-Agent': 'rendra-ide-setup' };

function run(file, args, { timeout = 120000, encoding = 'utf8' } = {}) {
  return new Promise(resolve => {
    execFile(file, args, { windowsHide: true, timeout, encoding, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, code: err?.code ?? 0, stdout, stderr }));
  });
}
const where = async cmd => {
  const r = await run(IS_WIN ? 'where.exe' : 'which', [cmd], { timeout: 10000 });
  return r.ok ? String(r.stdout).split(/\r?\n/).find(Boolean) || null : null;
};

// ── Checks ───────────────────────────────────────────────────────────────────
async function gitPath() {
  if (IS_WIN) {
    // Git Bash specifically (the DevCode terminal option), not just git.exe on PATH
    return [path.join(PROGRAM_FILES, 'Git', 'bin', 'bash.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe')]
      .find(p => fs.existsSync(p)) || null;
  }
  const git = await where('git');
  if (!git) return null;
  // macOS ships a /usr/bin/git stub that only offers to install the tools: make sure it runs
  return (await run(git, ['--version'], { timeout: 15000 })).ok ? git : null;
}

async function rtkPath() {
  if (fs.existsSync(RTK_BIN)) return RTK_BIN;
  return where('rtk');
}

async function listWslDistros(timeout = 15000) {
  if (!IS_WIN) return null;
  const r = await run('wsl.exe', ['-l', '-v'], { timeout, encoding: 'buffer' });
  if (!r.ok || !r.stdout) return null; // WSL not installed (or not enabled)
  const out = r.stdout.toString('utf16le').replace(/\0/g, '');
  return out.split(/\r?\n/).slice(1)
    .map(l => l.match(/^\s*(\*)?\s*(\S+)\s+(\S+)\s+(\d)\s*$/))
    .filter(m => m && !/^docker-desktop/i.test(m[2]))
    .map(m => ({ name: m[2], state: m[3], version: +m[4], isDefault: !!m[1] }));
}

async function check() {
  const [rtk, git, winget, distros] = await Promise.all([rtkPath(), gitPath(), IS_WIN ? where('winget') : null, listWslDistros()]);
  let rtkVersion = null;
  let rtkHook = false;
  if (rtk) {
    rtkVersion = (await run(rtk, ['--version'], { timeout: 15000 })).stdout?.trim() || null;
    rtkHook = /\[ok\]\s*Hook/i.test((await run(rtk, ['init', '--show'], { timeout: 15000 })).stdout || '');
  }
  return {
    supported: true,
    platform: process.platform,
    winget: !!winget,
    git: { installed: !!git, path: git },
    rtk: { installed: !!rtk, path: rtk, version: rtkVersion, hook: rtkHook },
    // WSL only matters on Windows; elsewhere it's reported as not applicable
    wsl: IS_WIN
      ? { applicable: true, installed: distros !== null, distros: distros || [], ready: !!distros?.length }
      : { applicable: false, installed: false, distros: [], ready: true },
  };
}

// ── Download helpers ─────────────────────────────────────────────────────────
async function latestRelease(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: UA });
  if (!res.ok) throw new Error(`GitHub respondeu HTTP ${res.status} para ${repo}`);
  return res.json();
}

async function download(url, dest, log, doFetch = fetch) {
  const res = await doFetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok) throw new Error(`Download falhou (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  log?.(`  baixado ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  return buf;
}

const psQuote = s => `'${String(s).replace(/'/g, "''")}'`;
const powershell = (script, timeout = 600000) =>
  run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout });

// Runs an installer elevated (one UAC prompt) and waits for it — Windows only
const runElevated = (file, args, timeout = 1800000) => powershell(
  `$p = Start-Process -FilePath ${psQuote(file)} -ArgumentList ${psQuote(args)} -Verb RunAs -Wait -PassThru; exit $p.ExitCode`,
  timeout,
);

// ── Git ──────────────────────────────────────────────────────────────────────
async function installGit(log) {
  if (IS_MAC) {
    // Apple's Command Line Tools include git; macOS shows its own install dialog
    log('Abrindo o instalador das Ferramentas de Linha de Comando da Apple (inclui o Git)…');
    await run('xcode-select', ['--install'], { timeout: 30000 });
    return { ok: true, note: 'Conclua a instalação na janela da Apple e verifique de novo.' };
  }
  if (!IS_WIN) {
    // Installing system packages on Linux needs sudo: give the exact command instead
    const pm = (await where('apt-get')) ? 'sudo apt-get install -y git'
      : (await where('dnf')) ? 'sudo dnf install -y git'
        : (await where('pacman')) ? 'sudo pacman -S --noconfirm git'
          : (await where('zypper')) ? 'sudo zypper install -y git' : 'instale o pacote "git" pelo gerenciador da sua distribuição';
    throw new Error(`No Linux o Git é instalado pelo sistema. Rode no terminal: ${pm}`);
  }
  if (await where('winget')) {
    log('Instalando o Git pelo winget (o Windows pode pedir permissão)…');
    const r = await run('winget', ['install', '--id', 'Git.Git', '-e', '--source', 'winget', '--silent',
      '--accept-package-agreements', '--accept-source-agreements'], { timeout: 1800000 });
    if (r.ok || await gitPath()) return { ok: true };
    log(`  winget falhou (${(r.stderr || r.stdout || '').trim().split('\n').pop()}); tentando o instalador oficial…`);
  }
  log('Baixando o instalador oficial do Git para Windows…');
  const rel = await latestRelease('git-for-windows/git');
  const asset = rel.assets.find(a => /^Git-[\d.]+-64-bit\.exe$/.test(a.name));
  if (!asset) throw new Error('Instalador do Git não encontrado na release');
  const exe = path.join(os.tmpdir(), asset.name);
  await download(asset.browser_download_url, exe, log);
  log('Executando o instalador (o Windows vai pedir permissão)…');
  await runElevated(exe, '/VERYSILENT /NORESTART /NOCANCEL /SP- /SUPPRESSMSGBOXES');
  fs.rmSync(exe, { force: true });
  if (!(await gitPath())) throw new Error('O Git não aparece instalado. A instalação foi cancelada?');
  return { ok: true };
}

// ── RTK ──────────────────────────────────────────────────────────────────────
// Release asset for an OS/CPU (github.com/rtk-ai/rtk/releases); defaults to this machine
function rtkAssetName(platform = process.platform, arch = process.arch) {
  const arm = arch === 'arm64';
  if (platform === 'win32') return 'rtk-x86_64-pc-windows-msvc.zip';
  if (platform === 'darwin') return arm ? 'rtk-aarch64-apple-darwin.tar.gz' : 'rtk-x86_64-apple-darwin.tar.gz';
  return arm ? 'rtk-aarch64-unknown-linux-gnu.tar.gz' : 'rtk-x86_64-unknown-linux-musl.tar.gz';
}

// `uname -m` of a distro → the `arch` that rtkAssetName understands (process.arch spelling)
function archFromUname(machine) {
  const m = String(machine || '').trim().toLowerCase();
  if (m === 'x86_64' || m === 'amd64') return 'x64';
  if (m === 'aarch64' || m === 'arm64') return 'arm64';
  return null;
}

async function ensureUserPath(dir, log) {
  if (IS_WIN) {
    const current = (await powershell("[Environment]::GetEnvironmentVariable('Path','User')")).stdout?.trim() || '';
    if (!current.toLowerCase().split(';').includes(dir.toLowerCase())) {
      await powershell(`[Environment]::SetEnvironmentVariable('Path', ${psQuote(current ? `${current};${dir}` : dir)}, 'User')`);
      log(`  ${dir} adicionado ao PATH do usuário`);
    }
  } else {
    // add ~/.local/bin to the shell startup files that exist (never create a new rc file)
    const line = `export PATH="$HOME/.local/bin:$PATH"`;
    for (const rc of ['.zshrc', '.bashrc', '.profile'].map(f => path.join(HOME, f)).filter(f => fs.existsSync(f))) {
      const text = fs.readFileSync(rc, 'utf8');
      if (!text.includes('.local/bin')) {
        fs.appendFileSync(rc, `\n# added by Rendra IDE (RTK)\n${line}\n`);
        log(`  PATH atualizado em ~/${path.basename(rc)}`);
      }
    }
  }
  // this process (and terminals it starts) sees it right away, no restart needed
  const sep = IS_WIN ? ';' : ':';
  const entries = process.env.PATH.split(sep).map(e => (IS_WIN ? e.toLowerCase() : e));
  if (!entries.includes(IS_WIN ? dir.toLowerCase() : dir)) process.env.PATH = `${dir}${sep}${process.env.PATH}`;
}

// Extracts a release archive: .zip with PowerShell (Windows), anything else with tar
async function extractArchive(archive, dir) {
  if (archive.endsWith('.zip')) await powershell(`Expand-Archive -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(dir)} -Force`);
  else await run('tar', ['-xzf', archive, '-C', dir], { timeout: 60000 });
}

// Downloads the release asset, checks it against the published SHA-256 and extracts the binary
// into a temp folder. Used for this machine and for WSL distros. The caller removes `tmp`.
// `deps` swaps network and extraction in tests.
async function fetchRtkRelease(log, assetName, binName, deps = {}) {
  const getRelease = deps.latestRelease || latestRelease;
  const doFetch = deps.fetch || fetch;
  const extract = deps.extract || extractArchive;
  log('Buscando a versão mais recente do RTK (github.com/rtk-ai/rtk)…');
  const rel = await getRelease('rtk-ai/rtk');
  const asset = rel.assets.find(a => a.name === assetName);
  const sums = rel.assets.find(a => a.name === 'checksums.txt');
  if (!asset) throw new Error(`Pacote do RTK (${assetName}) não encontrado na release`);
  log(`  versão ${rel.tag_name} · ${assetName}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-'));
  try {
    const archive = path.join(tmp, asset.name);
    const buf = await download(asset.browser_download_url, archive, log, doFetch);
    if (sums) {
      // refuse a download that doesn't match the release's published checksum
      const text = await (await doFetch(sums.browser_download_url, { headers: UA })).text();
      const expected = text.split(/\r?\n/).find(l => l.includes(asset.name))?.split(/\s+/)[0]?.toLowerCase();
      const actual = crypto.createHash('sha256').update(buf).digest('hex');
      if (expected && expected !== actual) throw new Error('Checksum do RTK não confere; instalação cancelada');
      log('  checksum SHA-256 conferido');
    }
    await extract(archive, tmp);
    const found = [tmp, ...fs.readdirSync(tmp).map(n => path.join(tmp, n))]
      .map(d => path.join(d, binName)).find(p => fs.existsSync(p));
    if (!found) throw new Error(`${binName} não encontrado no pacote`);
    return { found, tmp, tag: rel.tag_name };
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

async function installRtk(log, binDir = BIN_DIR, { updatePath = true } = {}) {
  const { found, tmp } = await fetchRtkRelease(log, rtkAssetName(), RTK_NAME);
  const target = path.join(binDir, RTK_NAME);
  try {
    fs.mkdirSync(binDir, { recursive: true });
    swapBinary(target, found); // never a plain copy: a running rtk.exe (hook) would fail with EBUSY
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  log(`  instalado em ${target}`);
  if (updatePath) await ensureUserPath(binDir, log);
  return { ok: true };
}

// Hook + RTK.md into ~/.claude so Claude Code routes shell output through rtk
async function enableRtkHook(log) {
  const rtk = await rtkPath();
  if (!rtk) throw new Error('RTK não está instalado');
  log('Ativando o RTK no Claude Code (rtk init -g)…');
  const r = await run(rtk, ['init', '-g', '--auto-patch'], { timeout: 60000 });
  if (!r.ok) throw new Error((r.stderr || r.stdout || 'rtk init falhou').trim());
  return { ok: true };
}

// ── WSL (Windows only) ───────────────────────────────────────────────────────
async function installWsl(log) {
  if (!IS_WIN) throw new Error('O WSL existe apenas no Windows');
  const distros = await listWslDistros();
  // no WSL at all → enable it and install Ubuntu; WSL without a usable distro → add Ubuntu
  log(distros === null
    ? 'Instalando o WSL com Ubuntu (o Windows vai pedir permissão)…'
    : 'Instalando a distribuição Ubuntu no WSL…');
  const r = await runElevated('wsl.exe', '--install -d Ubuntu --no-launch');
  const after = await listWslDistros();
  if (after?.length) return { ok: true, needsReboot: false };
  // enabling the Windows feature only completes after a restart
  return { ok: r.ok, needsReboot: true };
}

module.exports = { listWslDistros, check, installGit, installRtk, fetchRtkRelease, gitPath, enableRtkHook, installWsl, rtkPath, rtkAssetName, archFromUname, BIN_DIR };
