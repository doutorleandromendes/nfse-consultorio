'use strict';
// Backup, restauração e arquivo de diagnóstico.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const AdmZip = require('adm-zip');
const { mascararDocumentos, hojeISO } = require('./util');

const PREFIXO = 'NotasConsultorio-backup-';
const MANTER = 30;

function fazerBackup({ arquivoDb, pastaDocumentos, pastaDestino }) {
  if (!pastaDestino) return null;
  fs.mkdirSync(pastaDestino, { recursive: true });
  const zip = new AdmZip();
  zip.addLocalFile(arquivoDb, '', 'notas.db');
  if (fs.existsSync(pastaDocumentos)) zip.addLocalFolder(pastaDocumentos, 'documentos');
  const d = new Date();
  const nome = `${PREFIXO}${hojeISO(d)}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.zip`;
  const destino = path.join(pastaDestino, nome);
  const tmp = destino + '.parcial';
  zip.writeZip(tmp);
  fs.renameSync(tmp, destino);
  // mantém só os mais recentes
  const antigos = fs.readdirSync(pastaDestino).filter((f) => f.startsWith(PREFIXO) && f.endsWith('.zip')).sort().reverse();
  for (const f of antigos.slice(MANTER)) {
    try { fs.unlinkSync(path.join(pastaDestino, f)); } catch (_) { /* ignora */ }
  }
  return destino;
}

/** Restaura um backup. Os dados atuais são guardados ao lado, por segurança. */
function restaurarBackup({ arquivoZip, arquivoDb, pastaDocumentos }) {
  const zip = new AdmZip(arquivoZip);
  const db = zip.getEntry('notas.db');
  if (!db) throw new Error('Este arquivo não é um backup do programa (falta notas.db).');
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  if (fs.existsSync(arquivoDb)) fs.copyFileSync(arquivoDb, `${arquivoDb}.antes-da-restauracao-${carimbo}`);
  if (fs.existsSync(pastaDocumentos)) fs.renameSync(pastaDocumentos, `${pastaDocumentos}.antes-da-restauracao-${carimbo}`);
  fs.mkdirSync(pastaDocumentos, { recursive: true });
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith('documentos/')) continue;
    const rel = e.entryName.slice('documentos/'.length);
    const destino = path.resolve(pastaDocumentos, rel);
    if (!destino.startsWith(path.resolve(pastaDocumentos) + path.sep)) continue; // proteção contra caminhos maliciosos
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, e.getData());
  }
  fs.writeFileSync(arquivoDb, db.getData());
}

/** Depois de restaurar, ajusta caminhos de XML/PDF para a pasta de documentos deste computador. */
function corrigirCaminhos(db, pastaDocumentos) {
  const notas = db.all('SELECT id, xml_path, pdf_path FROM notas WHERE xml_path IS NOT NULL OR pdf_path IS NOT NULL');
  const ajustar = (p) => {
    if (!p) return p;
    // XML/PDF ficam em <pasta>/[TESTE/]AAAA-MM/arquivo — reaproveita só essa parte final
    const m = p.replace(/\\/g, '/').match(/((?:TESTE\/)?\d{4}-\d{2}\/[^/]+)$/);
    return m ? path.join(pastaDocumentos, ...m[1].split('/')) : p;
  };
  db.tx(() => {
    for (const n of notas) {
      db.run('UPDATE notas SET xml_path = ?, pdf_path = ? WHERE id = ?', [ajustar(n.xml_path), ajustar(n.pdf_path), n.id]);
    }
  });
}

function gerarDiagnostico({ db, config, versao, destino, pendencias, certInfo, logFile }) {
  const zip = new AdmZip();
  const cfg = { ...config.all() };
  delete cfg.cert_senha;
  const info = {
    gerado_em: new Date().toISOString(),
    versao_programa: versao,
    sistema: `${os.platform()} ${os.release()} ${os.arch()}`,
    electron: process.versions.electron,
    node: process.versions.node,
    configuracao: cfg,
    pendencias,
    certificado: certInfo,
    contagem_notas: db.all('SELECT ambiente, status, COUNT(*) AS qtd FROM notas GROUP BY ambiente, status'),
  };
  zip.addFile('info.json', Buffer.from(mascararDocumentos(JSON.stringify(info, null, 2)), 'utf8'));
  const naoEmitidas = db.all(
    `SELECT id, ambiente, status, serie, n_dps, id_dps, data_servico, valor, mensagens, atualizado_em
     FROM notas WHERE status NOT IN ('autorizada','cancelada') ORDER BY id DESC LIMIT 100`);
  zip.addFile('notas-pendentes.json', Buffer.from(mascararDocumentos(JSON.stringify(naoEmitidas, null, 2)), 'utf8'));
  const eventos = db.all('SELECT * FROM eventos ORDER BY id DESC LIMIT 300');
  zip.addFile('eventos.json', Buffer.from(mascararDocumentos(JSON.stringify(eventos, null, 2)), 'utf8'));
  if (logFile && fs.existsSync(logFile)) {
    zip.addFile('programa.log', Buffer.from(mascararDocumentos(fs.readFileSync(logFile, 'utf8').slice(-500_000)), 'utf8'));
  }
  zip.writeZip(destino);
  return destino;
}

module.exports = { fazerBackup, restaurarBackup, corrigirCaminhos, gerarDiagnostico };
