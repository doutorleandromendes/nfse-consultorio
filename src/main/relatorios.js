'use strict';
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { paraCsv, fmtCpf, fmtDataBR, numBR } = require('./util');

const STATUS_PT = {
  rascunho: 'Não enviada', enviando: 'Enviando', incerta: 'A verificar', autorizada: 'Emitida',
  rejeitada: 'Recusada', cancelada: 'Cancelada',
};

class Relatorios {
  constructor(db, config) {
    this.db = db;
    this.config = config;
  }

  notasDoMes(ano, mes, ambiente = this.config.get('ambiente')) {
    const ini = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const fim = `${ano}-${String(mes).padStart(2, '0')}-31`;
    return this.db.all(
      `SELECT * FROM notas WHERE ambiente = ? AND data_servico BETWEEN ? AND ?
         AND status IN ('autorizada','cancelada') ORDER BY CAST(numero_nfse AS INTEGER), id`,
      [ambiente, ini, fim]);
  }

  resumoMes(ano, mes) {
    const notas = this.notasDoMes(ano, mes);
    const emitidas = notas.filter((n) => n.status === 'autorizada');
    return {
      emitidas: emitidas.length,
      canceladas: notas.length - emitidas.length,
      total: emitidas.reduce((s, n) => s + n.valor, 0),
    };
  }

  /** Pacote para a contadora: planilha + XML + PDF de todas as notas do mês. */
  pacoteMensal(ano, mes, destinoZip) {
    const notas = this.notasDoMes(ano, mes);
    if (!notas.length) throw new Error('Nenhuma nota emitida neste mês.');
    const csv = paraCsv(notas, [
      { titulo: 'Número NFS-e', valor: (n) => n.numero_nfse },
      { titulo: 'Data do atendimento', valor: (n) => fmtDataBR(n.data_servico) },
      { titulo: 'Emitida em', valor: (n) => (n.emitida_em ? new Date(n.emitida_em).toLocaleString('pt-BR') : '') },
      { titulo: 'Tomador (quem pagou)', valor: (n) => n.tomador_nome },
      { titulo: 'CPF tomador', valor: (n) => fmtCpf(n.tomador_cpf) },
      { titulo: 'Paciente (se diferente)', valor: (n) => n.benef_nome || '' },
      { titulo: 'Valor (R$)', valor: (n) => numBR(n.valor) },
      { titulo: 'Situação', valor: (n) => STATUS_PT[n.status] },
      { titulo: 'Motivo cancelamento', valor: (n) => n.motivo_cancelamento || '' },
      { titulo: 'Chave de acesso', valor: (n) => n.chave_acesso },
    ]);
    const emitidas = notas.filter((n) => n.status === 'autorizada');
    const total = emitidas.reduce((s, n) => s + n.valor, 0);
    const resumo = `${csv}\r\n;;;;;Total emitido;${numBR(total)};${emitidas.length} nota(s)\r\n`;

    const zip = new AdmZip();
    const rotulo = `${ano}-${String(mes).padStart(2, '0')}`;
    zip.addFile(`Notas ${rotulo}.csv`, Buffer.from(resumo, 'utf8'));
    for (const n of notas) {
      for (const f of [n.xml_path, n.pdf_path, n.xml_path && n.xml_path.replace(/\.xml$/i, ' - CANCELAMENTO.xml')]) {
        if (f && fs.existsSync(f)) zip.addLocalFile(f, path.basename(f).endsWith('.pdf') ? 'PDF' : 'XML');
      }
    }
    zip.writeZip(destinoZip);
    return { arquivo: destinoZip, notas: notas.length, total };
  }

  /**
   * Base para a DMED: soma anual por responsável pelo pagamento (tomador) e beneficiário.
   * Considera apenas notas reais emitidas e não canceladas.
   */
  dmed(ano, destinoCsv) {
    const linhas = this.db.all(
      `SELECT tomador_cpf, MAX(tomador_nome) AS tomador_nome, coalesce(benef_cpf,'') AS benef_cpf,
              MAX(benef_nome) AS benef_nome, MAX(benef_nasc) AS benef_nasc,
              SUM(valor) AS total, COUNT(*) AS qtd
       FROM notas
       WHERE ambiente = 'producao' AND status = 'autorizada' AND data_servico BETWEEN ? AND ?
       GROUP BY tomador_cpf, coalesce(benef_cpf,'')
       ORDER BY tomador_nome COLLATE NOCASE`,
      [`${ano}-01-01`, `${ano}-12-31`]);
    if (!linhas.length) throw new Error(`Nenhuma nota real emitida em ${ano}.`);
    const csv = paraCsv(linhas, [
      { titulo: 'CPF responsável pelo pagamento', valor: (l) => fmtCpf(l.tomador_cpf) },
      { titulo: 'Nome responsável pelo pagamento', valor: (l) => l.tomador_nome },
      { titulo: 'CPF beneficiário (se diferente)', valor: (l) => (l.benef_cpf ? fmtCpf(l.benef_cpf) : '') },
      { titulo: 'Nome beneficiário', valor: (l) => l.benef_nome || '' },
      { titulo: 'Nascimento beneficiário', valor: (l) => fmtDataBR(l.benef_nasc) },
      { titulo: 'Valor pago no ano (R$)', valor: (l) => numBR(l.total) },
      { titulo: 'Qtd. notas', valor: (l) => l.qtd },
    ]);
    fs.writeFileSync(destinoCsv, csv, 'utf8');
    return { arquivo: destinoCsv, linhas: linhas.length, total: linhas.reduce((s, l) => s + l.total, 0) };
  }
}

module.exports = { Relatorios, STATUS_PT };
