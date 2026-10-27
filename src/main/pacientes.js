'use strict';
const { onlyDigits, cpfValido } = require('./util');

const CAMPOS = ['nome', 'cpf', 'email', 'telefone', 'valor_padrao', 'benef_nome', 'benef_cpf', 'benef_nasc',
  'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio_ibge', 'observacao', 'ativo'];

function normalizar(p) {
  const o = {};
  for (const k of CAMPOS) {
    if (p[k] === undefined) continue;
    let v = p[k];
    if (typeof v === 'string') v = v.trim();
    if (v === '') v = null;
    o[k] = v;
  }
  if (o.nome) o.nome = o.nome.replace(/\s+/g, ' ');
  if (o.cpf != null) o.cpf = onlyDigits(o.cpf);
  if (o.benef_cpf != null) o.benef_cpf = onlyDigits(o.benef_cpf) || null;
  if (o.cep != null) o.cep = onlyDigits(o.cep) || null;
  if (o.valor_padrao != null) {
    let t = String(o.valor_padrao).replace(/[R$\s]/g, '');
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    const n = Number(t);
    o.valor_padrao = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  }
  return o;
}

function validar(o) {
  if (!o.nome || o.nome.length < 3) throw new Error('Informe o nome completo de quem paga.');
  if (!cpfValido(o.cpf)) throw new Error('CPF inválido. Confira os números.');
  if (o.benef_cpf && !cpfValido(o.benef_cpf)) throw new Error('CPF do paciente (beneficiário) inválido.');
  if (o.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) throw new Error('E-mail inválido.');
  if (o.benef_nome && o.benef_cpf && o.benef_cpf === o.cpf) {
    throw new Error('O paciente tem o mesmo CPF de quem paga — nesse caso deixe os campos do paciente em branco.');
  }
}

class Pacientes {
  constructor(db) {
    this.db = db;
  }

  listar({ busca = '', incluirInativos = false } = {}) {
    const termo = `%${busca.trim().toLowerCase()}%`;
    const dig = onlyDigits(busca);
    return this.db.all(
      `SELECT p.*, (SELECT MAX(data_servico) FROM notas n WHERE n.paciente_id = p.id AND n.status = 'autorizada') AS ultima_nota
       FROM pacientes p
       WHERE (? = 1 OR p.ativo = 1)
         AND (lower(p.nome) LIKE ? OR lower(coalesce(p.benef_nome,'')) LIKE ? OR (? <> '' AND p.cpf LIKE ?))
       ORDER BY p.nome COLLATE NOCASE LIMIT 500`,
      [incluirInativos ? 1 : 0, termo, termo, dig, `%${dig}%`]);
  }

  obter(id) {
    return this.db.get('SELECT * FROM pacientes WHERE id = ?', [id]);
  }

  salvar(dados) {
    const o = normalizar(dados);
    const atual = dados.id ? this.obter(dados.id) : null;
    validar({ ...(atual || {}), ...o });
    const dup = this.db.get('SELECT id, nome FROM pacientes WHERE cpf = ? AND id <> ?', [o.cpf ?? atual?.cpf, dados.id || 0]);
    if (dup) throw new Error(`Já existe um cadastro com este CPF: ${dup.nome}.`);
    if (atual) {
      const ks = Object.keys(o);
      this.db.run(`UPDATE pacientes SET ${ks.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...ks.map((k) => o[k]), atual.id]);
      return this.obter(atual.id);
    }
    const ks = Object.keys(o);
    const id = this.db.run(`INSERT INTO pacientes (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`, ks.map((k) => o[k]));
    return this.obter(id);
  }

  /** Importa uma planilha CSV com colunas nome;cpf;email;valor (cabeçalho obrigatório). */
  importarCsv(texto) {
    const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    if (linhas.length < 2) throw new Error('A planilha está vazia.');
    const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ',';
    const cab = linhas[0].split(sep).map((c) => c.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
    const idx = (...nomes) => cab.findIndex((c) => nomes.includes(c));
    const iNome = idx('nome', 'paciente', 'nome completo');
    const iCpf = idx('cpf');
    const iEmail = idx('email', 'e-mail');
    const iValor = idx('valor', 'valor consulta', 'valor_padrao');
    if (iNome < 0 || iCpf < 0) throw new Error('A planilha precisa ter as colunas "nome" e "cpf" na primeira linha.');
    const res = { importados: 0, ignorados: [] };
    this.db.tx(() => {
      linhas.slice(1).forEach((l, i) => {
        const c = l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''));
        try {
          if (this.db.get('SELECT 1 AS x FROM pacientes WHERE cpf = ?', [onlyDigits(c[iCpf])])) {
            throw new Error('CPF já cadastrado');
          }
          this.salvar({ nome: c[iNome], cpf: c[iCpf], email: iEmail >= 0 ? c[iEmail] : undefined,
            valor_padrao: iValor >= 0 ? c[iValor] : undefined });
          res.importados++;
        } catch (e) {
          res.ignorados.push(`Linha ${i + 2}: ${e.message}`);
        }
      });
    });
    return res;
  }
}

module.exports = { Pacientes };
