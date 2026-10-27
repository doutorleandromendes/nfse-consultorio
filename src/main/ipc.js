'use strict';
// Canal entre a tela (renderer) e a lógica (main). Toda resposta vem como {ok, dados} ou {ok:false, erro}.
const fs = require('node:fs');
const path = require('node:path');
const { dialog, shell, BrowserWindow, app } = require('electron');
const { CAMPOS, GRUPOS } = require('./config');
const { hojeISO } = require('./util');
const manut = require('./manutencao');

function registrar(ipcMain, ctx) {
  // comEvento: o handler recebe o evento IPC como último argumento (usado no lote para enviar progresso).
  const handle = (canal, fn, { comEvento = false } = {}) => {
    ipcMain.handle(canal, async (ev, ...args) => {
      try {
        return { ok: true, dados: await (comEvento ? fn(...args, ev) : fn(...args)) };
      } catch (e) {
        ctx.log(`[erro] ${canal}: ${e && e.stack || e}`);
        return { ok: false, erro: String(e && e.message || e) };
      }
    });
  };
  const janela = () => BrowserWindow.getFocusedWindow() || ctx.janela();
  const { db, config, certificado, emissor, pacientes, relatorios } = ctx;

  // ── estado geral ───────────────────────────────────────────────────
  handle('estado', () => {
    const hoje = new Date();
    const amb = config.get('ambiente');
    return {
      versao: app.getVersion(),
      ambiente: amb,
      pendencias: config.pendencias(),
      fiscalConferido: config.get('fiscal_conferido') === '1',
      certificado: certificado.info(),
      empresa: config.get('razao_social'),
      resumoMes: relatorios.resumoMes(hoje.getFullYear(), hoje.getMonth() + 1),
      rascunhos: db.get("SELECT COUNT(*) AS n FROM notas WHERE status='rascunho' AND ambiente=?", [amb]).n,
      aVerificar: db.get("SELECT COUNT(*) AS n FROM notas WHERE status IN ('incerta','enviando') AND ambiente=?", [amb]).n,
      recusadas: db.get("SELECT COUNT(*) AS n FROM notas WHERE status='rejeitada' AND ambiente=?", [amb]).n,
      backupPasta: config.get('backup_pasta'),
      atualizacao: ctx.estadoAtualizacao,
      pastaDocumentos: ctx.pastaDocumentos,
    };
  });

  // ── configurações ──────────────────────────────────────────────────
  handle('config:campos', () => ({ campos: CAMPOS, grupos: GRUPOS, valores: (({ cert_senha, ...v }) => v)(config.all()) }));
  handle('config:salvar', (valores) => {
    const permitidas = new Set(CAMPOS.map((c) => c.chave));
    const limpo = Object.fromEntries(Object.entries(valores).filter(([k]) => permitidas.has(k)));
    config.setMany(limpo);
    return config.pendencias();
  });
  handle('config:instalarCertificado', async (senha) => {
    const r = await dialog.showOpenDialog(janela(), {
      title: 'Escolha o arquivo do certificado digital (e-CNPJ A1)',
      filters: [{ name: 'Certificado A1', extensions: ['pfx', 'p12'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return certificado.instalar(r.filePaths[0], senha);
  });
  handle('config:trocarAmbiente', (amb) => {
    if (!['homologacao', 'producao'].includes(amb)) throw new Error('Ambiente inválido.');
    if (amb === 'producao') {
      const p = config.pendencias();
      if (p.length) throw new Error('Antes de emitir notas reais:\n' + p.join('\n'));
      if (config.get('fiscal_conferido') !== '1') {
        throw new Error('Marque "A contadora conferiu os dados fiscais" em Configurações antes de emitir notas reais.');
      }
    }
    config.set('ambiente', amb);
    return amb;
  });

  // ── pacientes ──────────────────────────────────────────────────────
  handle('pacientes:listar', (filtro) => pacientes.listar(filtro || {}));
  handle('pacientes:obter', (id) => pacientes.obter(id));
  handle('pacientes:salvar', (dados) => pacientes.salvar(dados));
  handle('pacientes:importar', async () => {
    const r = await dialog.showOpenDialog(janela(), {
      title: 'Escolha a planilha de pacientes (CSV)', filters: [{ name: 'Planilha CSV', extensions: ['csv', 'txt'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const buf = fs.readFileSync(r.filePaths[0]);
    let texto = buf.toString('utf8');
    if (texto.includes('�')) texto = buf.toString('latin1'); // planilhas salvas pelo Excel em ANSI
    return pacientes.importarCsv(texto);
  });

  // ── notas ──────────────────────────────────────────────────────────
  handle('notas:listar', ({ ano, mes, status, busca } = {}) => {
    const amb = config.get('ambiente');
    const params = [amb];
    let where = 'ambiente = ?';
    if (ano && mes) {
      const m = String(mes).padStart(2, '0');
      where += ' AND data_servico BETWEEN ? AND ?';
      params.push(`${ano}-${m}-01`, `${ano}-${m}-31`);
    }
    if (status === 'pendentes') where += " AND status IN ('rascunho','incerta','enviando','rejeitada')";
    else if (status) { where += ' AND status = ?'; params.push(status); }
    if (busca && busca.trim()) {
      where += ' AND (lower(tomador_nome) LIKE ? OR lower(coalesce(benef_nome,\'\')) LIKE ? OR numero_nfse = ?)';
      const t = `%${busca.trim().toLowerCase()}%`;
      params.push(t, t, busca.trim());
    }
    return db.all(`SELECT * FROM notas WHERE ${where} ORDER BY data_servico DESC, id DESC LIMIT 1000`, params)
      .map((n) => ({ ...n, mensagens: n.mensagens ? JSON.parse(n.mensagens) : [] }));
  });
  handle('notas:ultimaDoPaciente', (pacienteId) => db.get(
    `SELECT valor, discriminacao, data_servico FROM notas WHERE paciente_id = ? AND status = 'autorizada'
     ORDER BY data_servico DESC, id DESC LIMIT 1`, [pacienteId]) || null);
  handle('notas:obter', (id) => emissor.nota(id));
  handle('notas:rascunho', (dados) => emissor.criarRascunho(dados));
  handle('notas:editar', (id, dados) => emissor.editarRascunho(id, dados));
  handle('notas:excluir', (id) => emissor.excluirRascunho(id));
  handle('notas:emitir', (id) => emissor.emitir(id));
  handle('notas:verificar', (id) => emissor.verificar(id));
  handle('notas:tentarNovamente', (id) => emissor.tentarNovamente(id));
  handle('notas:cancelar', (id, dados) => emissor.cancelar(id, dados));
  handle('notas:gerarPdf', (id) => emissor.gerarPdf(id));
  handle('notas:lote', async (ids, ev) => emissor.emitirLote(ids, (p) => ev.sender.send('lote:progresso', p)),
    { comEvento: true });
  handle('notas:abrirPdf', async (id) => {
    const n = emissor.nota(id);
    let p = n.pdf_path;
    if (!p || !fs.existsSync(p)) p = await emissor.gerarPdf(id);
    const erro = await shell.openPath(p);
    if (erro) throw new Error(erro);
  });
  handle('notas:mostrarNaPasta', (id) => {
    const n = emissor.nota(id);
    const p = [n.pdf_path, n.xml_path].find((f) => f && fs.existsSync(f));
    if (!p) throw new Error('Arquivo da nota não encontrado.');
    shell.showItemInFolder(p);
  });

  // ── relatórios ─────────────────────────────────────────────────────
  handle('relatorios:mensal', async (ano, mes) => {
    const rotulo = `${ano}-${String(mes).padStart(2, '0')}`;
    const r = await dialog.showSaveDialog(janela(), {
      title: 'Salvar pacote para a contadora',
      defaultPath: path.join(app.getPath('desktop'), `Notas ${rotulo} - para a contadora.zip`),
      filters: [{ name: 'Arquivo ZIP', extensions: ['zip'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const res = relatorios.pacoteMensal(ano, mes, r.filePath);
    shell.showItemInFolder(r.filePath);
    return res;
  });
  handle('relatorios:dmed', async (ano) => {
    const r = await dialog.showSaveDialog(janela(), {
      title: 'Salvar planilha da DMED',
      defaultPath: path.join(app.getPath('desktop'), `DMED ${ano} - base.csv`),
      filters: [{ name: 'Planilha CSV', extensions: ['csv'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const res = relatorios.dmed(ano, r.filePath);
    shell.showItemInFolder(r.filePath);
    return res;
  });

  // ── manutenção ─────────────────────────────────────────────────────
  handle('manut:escolherPastaBackup', async () => {
    const r = await dialog.showOpenDialog(janela(), {
      title: 'Escolha a pasta onde os backups serão guardados', properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    config.set('backup_pasta', r.filePaths[0]);
    return r.filePaths[0];
  });
  handle('manut:backupAgora', () => {
    if (!config.get('backup_pasta')) throw new Error('Escolha antes a pasta de backup em Configurações.');
    return ctx.fazerBackup();
  });
  handle('manut:restaurar', async () => {
    const r = await dialog.showOpenDialog(janela(), {
      title: 'Escolha o arquivo de backup', filters: [{ name: 'Backup', extensions: ['zip'] }], properties: ['openFile'],
      defaultPath: config.get('backup_pasta') || undefined,
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const conf = await dialog.showMessageBox(janela(), {
      type: 'warning', buttons: ['Cancelar', 'Restaurar'], defaultId: 0, cancelId: 0,
      message: 'Restaurar este backup?',
      detail: 'Os dados atuais serão substituídos pelos do backup (uma cópia dos atuais fica guardada). O programa será reiniciado.',
    });
    if (conf.response !== 1) return null;
    await ctx.restaurar(r.filePaths[0]);
    return true;
  });
  handle('manut:diagnostico', () => {
    const destino = path.join(app.getPath('desktop'), `diagnostico-notas-${hojeISO()}.zip`);
    manut.gerarDiagnostico({
      db, config, versao: app.getVersion(), destino, pendencias: config.pendencias(),
      certInfo: certificado.info(), logFile: ctx.logFile,
    });
    shell.showItemInFolder(destino);
    return destino;
  });
  handle('manut:abrirDocumentos', () => {
    fs.mkdirSync(ctx.pastaDocumentos, { recursive: true });
    return shell.openPath(ctx.pastaDocumentos);
  });
  handle('manut:instalarAtualizacao', () => ctx.instalarAtualizacao());
}

module.exports = { registrar };
