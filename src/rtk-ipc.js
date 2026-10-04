/*! Rendra IDE v1.7.1 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// RTK: canais IPC. O id do ambiente e o agente vêm do renderer e nunca são confiados: o id é
// resolvido contra a lista real de ambientes (host ou distro devolvida por `wsl -l -v`) e o
// agente só vale se for claude ou codex. Qualquer outro valor é recusado antes de qualquer
// chamada a wsl.exe ou ao disco.

const AGENTS = ['claude', 'codex'];

function registerRtkIpc({ ipcMain, env, status, install, enable, log = () => {} }) {
  ipcMain.handle('rtk-status', () => status.status());
  ipcMain.handle('rtk-run', (_e, key) => status.run(key));

  ipcMain.handle('rtk-install', async (_e, id) => {
    const target = await env.resolveEnvironment(id);
    if (!target) return { ok: false, error: 'Ambiente inválido.' };
    return install.install(target, log);
  });

  if (enable) {
    ipcMain.handle('rtk-enable', async (_e, req) => {
      const agent = req && req.agent;
      if (!AGENTS.includes(agent)) return { ok: false, error: 'Agente inválido.' };
      const target = await env.resolveEnvironment(req && req.env);
      if (!target) return { ok: false, error: 'Ambiente inválido.' };
      return enable.enable(target, agent, log);
    });
  }
}

module.exports = { registerRtkIpc, AGENTS };
