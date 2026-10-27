'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, BrowserWindow, ipcMain, safeStorage, dialog, Menu } = require('electron');
const { Database } = require('./db');
const { Config } = require('./config');
const { GerenciadorCertificado } = require('./cert');
const { Emissor } = require('./emissor');
const { Pacientes } = require('./pacientes');
const { Relatorios } = require('./relatorios');
const manut = require('./manutencao');
const ipc = require('./ipc');

app.commandLine.appendSwitch('lang', 'pt-BR'); // datas e calendários sempre em dd/mm/aaaa

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Em desenvolvimento, NFSE_DADOS permite usar uma pasta de dados separada (ex.: demonstração).
if (!app.isPackaged && process.env.NFSE_DADOS) {
  app.setPath('userData', path.join(process.env.NFSE_DADOS, 'dados'));
  app.setPath('documents', path.join(process.env.NFSE_DADOS, 'documentos'));
}
const pastaDados = app.getPath('userData');
const arquivoDb = path.join(pastaDados, 'notas.db');
const caminhoPfx = path.join(pastaDados, 'certificado.pfx');
const logFile = path.join(pastaDados, 'programa.log');
const pastaDocumentos = path.join(app.getPath('documents'), 'Notas do Consultório');

function log(msg) {
  try {
    fs.mkdirSync(pastaDados, { recursive: true });
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2_000_000) fs.renameSync(logFile, logFile + '.antigo');
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}${os.EOL}`);
  } catch (_) { /* nunca derrubar o programa por causa de log */ }
}
process.on('uncaughtException', (e) => log(`[uncaught] ${e && e.stack || e}`));
process.on('unhandledRejection', (e) => log(`[unhandled] ${e && e.stack || e}`));

const cofre = {
  cifrar(s) {
    if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(s).toString('base64');
    return 'b64:' + Buffer.from(s, 'utf8').toString('base64'); // só em sistemas sem cofre (não ocorre no Windows/macOS)
  },
  decifrar(v) {
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
    if (v.startsWith('b64:')) return Buffer.from(v.slice(4), 'base64').toString('utf8');
    throw new Error('Senha do certificado ilegível. Instale o certificado novamente em Configurações.');
  },
};

/** Converte o HTML da DANFSe em PDF usando o próprio Chromium do Electron. */
async function htmlParaPdf(html, destino) {
  const tmp = path.join(os.tmpdir(), `danfse-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await w.loadFile(tmp);
    const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'default' } });
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, pdf);
  } finally {
    w.destroy();
    fs.rmSync(tmp, { force: true });
  }
}

let janelaPrincipal = null;
const ctx = {
  log, logFile, pastaDocumentos, estadoAtualizacao: null,
  janela: () => janelaPrincipal,
};

function criarJanela() {
  janelaPrincipal = new BrowserWindow({
    width: 1200, height: 820, minWidth: 900, minHeight: 600,
    title: 'Notas do Consultório',
    backgroundColor: '#f2f4f3',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  janelaPrincipal.once('ready-to-show', () => janelaPrincipal.show());
  janelaPrincipal.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // links externos (ajuda, sites) abrem no navegador
  janelaPrincipal.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });
  janelaPrincipal.webContents.on('will-navigate', (e) => e.preventDefault());
  janelaPrincipal.on('closed', () => { janelaPrincipal = null; });
}

function configurarAtualizacoes() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    log(`[update] indisponível: ${e.message}`);
    return;
  }
  autoUpdater.logger = { info: (m) => log(`[update] ${m}`), warn: (m) => log(`[update] ${m}`), error: (m) => log(`[update] ${m}`), debug: () => {} };
  autoUpdater.autoInstallOnAppQuit = true;
  const avisar = (estado) => {
    ctx.estadoAtualizacao = estado;
    if (janelaPrincipal) janelaPrincipal.webContents.send('atualizacao', estado);
  };
  autoUpdater.on('update-available', (i) => avisar({ fase: 'baixando', versao: i.version }));
  autoUpdater.on('update-downloaded', (i) => avisar({ fase: 'pronta', versao: i.version }));
  autoUpdater.on('error', (e) => log(`[update] erro: ${e && e.message}`));
  ctx.instalarAtualizacao = () => setImmediate(() => { app.isQuitting = true; autoUpdater.quitAndInstall(); });
  const checar = () => autoUpdater.checkForUpdates().catch((e) => log(`[update] falha: ${e.message}`));
  checar();
  setInterval(checar, 6 * 60 * 60 * 1000);
}

async function iniciar() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'Editar', submenu: [{ role: 'undo', label: 'Desfazer' }, { role: 'redo', label: 'Refazer' }, { type: 'separator' },
      { role: 'cut', label: 'Recortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' },
      { role: 'selectAll', label: 'Selecionar tudo' }] },
    { label: 'Exibir', submenu: [{ role: 'reload', label: 'Recarregar' }, { role: 'zoomIn', label: 'Aumentar letra' },
      { role: 'zoomOut', label: 'Diminuir letra' }, { role: 'resetZoom', label: 'Tamanho normal' }, { type: 'separator' },
      { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' }] },
  ]));

  let db;
  try {
    db = await Database.open(arquivoDb);
  } catch (e) {
    log(`[fatal] banco: ${e.stack}`);
    dialog.showErrorBox('Notas do Consultório', `Não foi possível abrir o banco de dados.\n\n${e.message}\n\n` +
      'Se tiver um backup, restaure-o. Em caso de dúvida, gere o diagnóstico e envie ao suporte.');
    app.quit();
    return;
  }
  const config = new Config(db);
  const certificado = new GerenciadorCertificado({ config, caminhoPfx, cofre });
  Object.assign(ctx, {
    db, config, certificado,
    pacientes: new Pacientes(db),
    relatorios: new Relatorios(db, config),
    emissor: new Emissor({
      db, config, certificado, pastaDocumentos, htmlParaPdf, versao: app.getVersion(),
      // Modo simulação (só em desenvolvimento): não fala com a prefeitura.
      ...(!app.isPackaged && process.env.NFSE_SIMULAR
        ? { criarCliente: require('../../test/helpers').criarClienteFalso(process.env.NFSE_SIMULAR.split(',').filter((x) => x !== '1'), { enviadas: [], consultas: [], cancelamentos: [], servidor: new Map() }) }
        : {}),
    }),
    fazerBackup: () => manut.fazerBackup({ arquivoDb, pastaDocumentos, pastaDestino: config.get('backup_pasta') }),
    instalarAtualizacao: () => { throw new Error('Nenhuma atualização pendente.'); },
    restaurar: async (zip) => {
      manut.restaurarBackup({ arquivoZip: zip, arquivoDb, pastaDocumentos });
      const novo = await Database.open(arquivoDb);
      manut.corrigirCaminhos(novo, pastaDocumentos);
      novo.close();
      app.isQuitting = true;
      ctx.pularBackup = true;
      app.relaunch();
      app.exit(0);
    },
  });
  ipc.registrar(ipcMain, ctx);
  criarJanela();
  configurarAtualizacoes();

  // Resolve notas que ficaram "a verificar" da última vez (ex.: internet caiu durante o envio).
  setTimeout(async () => {
    try {
      if (!ctx.config.pendencias().length) {
        const r = await ctx.emissor.reconciliarPendentes();
        if (r.length && janelaPrincipal) janelaPrincipal.webContents.send('reconciliado', r.length);
      }
    } catch (e) {
      log(`[reconciliar] ${e.stack}`);
    }
  }, 3000);
}

app.on('second-instance', () => {
  if (janelaPrincipal) {
    if (janelaPrincipal.isMinimized()) janelaPrincipal.restore();
    janelaPrincipal.focus();
  }
});

app.on('before-quit', () => {
  if (ctx.backupFeito || ctx.pularBackup || !ctx.config) return;
  ctx.backupFeito = true;
  try {
    const f = ctx.fazerBackup();
    if (f) log(`[backup] ${f}`);
  } catch (e) {
    log(`[backup] falhou: ${e.stack}`);
  }
});

app.on('window-all-closed', () => app.quit());
app.whenReady().then(iniciar);
