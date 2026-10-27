'use strict';

const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');

function cpfValido(v) {
  const c = onlyDigits(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
    const d = ((s * 10) % 11) % 10;
    if (d !== Number(c[t])) return false;
  }
  return true;
}

function cnpjValido(v) {
  const c = onlyDigits(v);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (len) => {
    const pesos = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((acc, p, i) => acc + Number(c[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

const fmtCpf = (v) => onlyDigits(v).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
const fmtCnpj = (v) => onlyDigits(v).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtDataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const fmtMoeda = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Data local em YYYY-MM-DD. */
function hojeISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Data/hora local com offset explícito (ex.: 2026-10-27T13:40:00-03:00).
 * Recuamos alguns segundos para evitar rejeição por "data de emissão futura"
 * quando o relógio do computador está levemente adiantado.
 */
function agoraComOffset(d = new Date(Date.now() - 60_000)) {
  const off = -d.getTimezoneOffset();
  const sinal = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sinal}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Mascara CPFs/CNPJs em texto (usado no arquivo de diagnóstico). */
function mascararDocumentos(texto) {
  return String(texto ?? '')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?(\d{2})\b/g, '***.***.***-$1')
    .replace(/(<(?:\w+:)?xNome>)[^<]*(<\/)/g, '$1[nome omitido]$2')
    .replace(/("(?:xNome|razaoSocial|tomador_nome|benef_nome|nome)"\s*:\s*")[^"]*"/g, '$1[nome omitido]"')
    .replace(/(<(?:\w+:)?email>)[^<]*(<\/)/g, '$1[e-mail omitido]$2')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail omitido]');
}

/** Preenche o modelo de discriminação. */
function montarDiscriminacao(modelo, dados) {
  const benefLinha = dados.benef_nome
    ? `Paciente: ${dados.benef_nome}${dados.benef_cpf ? ` (CPF ${fmtCpf(dados.benef_cpf)})` : ''}.`
    : '';
  return String(modelo || '')
    .replaceAll('{data}', fmtDataBR(dados.data_servico))
    .replaceAll('{valor}', fmtMoeda(dados.valor))
    .replaceAll('{paciente}', dados.benef_nome || dados.tomador_nome || '')
    .replaceAll('{pagador}', dados.tomador_nome || '')
    .replaceAll('{beneficiario}', benefLinha)
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function csvCelula(v) {
  const s = v == null ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV no formato que o Excel brasileiro abre direto (ponto e vírgula + BOM). */
function paraCsv(linhas, colunas) {
  const head = colunas.map((c) => csvCelula(c.titulo)).join(';');
  const body = linhas.map((l) => colunas.map((c) => csvCelula(c.valor(l))).join(';'));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}

const numBR = (n) => Number(n || 0).toFixed(2).replace('.', ',');

module.exports = {
  onlyDigits, cpfValido, cnpjValido, fmtCpf, fmtCnpj, fmtDataBR, fmtMoeda,
  hojeISO, agoraComOffset, mascararDocumentos, montarDiscriminacao, paraCsv, numBR,
};
