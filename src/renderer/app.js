'use strict';
/* global api, AJUDA_HTML */

// ── utilidades ──────────────────────────────────────────────────────────
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dig = (s) => String(s ?? '').replace(/\D/g, '');
const fmtCpf = (v) => dig(v).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
const fmtCnpj = (v) => dig(v).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtData = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const fmtMoeda = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const valorParaCampo = (n) => (n ? Number(n).toFixed(2).replace('.', ',') : '');
const pad = (n) => String(n).padStart(2, '0');
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const mesAtual = () => hoje().slice(0, 7);

function cpfValido(v) {
  const c = dig(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}

function montarTexto(modelo, d) {
  const benef = d.benef_nome ? `Paciente: ${d.benef_nome}${d.benef_cpf ? ` (CPF ${fmtCpf(d.benef_cpf)})` : ''}.` : '';
  return String(modelo || '')
    .replaceAll('{data}', fmtData(d.data_servico)).replaceAll('{valor}', fmtMoeda(d.valor))
    .replaceAll('{paciente}', d.benef_nome || d.tomador_nome || '').replaceAll('{pagador}', d.tomador_nome || '')
    .replaceAll('{beneficiario}', benef).replace(/[ \t]+/g, ' ').trim();
}

const STATUS = {
  rascunho: 'Não enviada', enviando: 'Enviando', incerta: 'A verificar', autorizada: 'Emitida',
  rejeitada: 'Recusada', cancelada: 'Cancelada',
};

function toast(msg, erro = false, ms = 5000) {
  const el = document.createElement('div');
  el.className = 'toast' + (erro ? ' erro' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), erro ? Math.max(ms, 9000) : ms);
}

/** Executa uma chamada mostrando o erro de forma amigável. */
async function tentar(fn, { botao } = {}) {
  const txt = botao && botao.textContent;
  if (botao) { botao.disabled = true; botao.textContent = 'Aguarde…'; }
  try {
    return await fn();
  } catch (e) {
    toast(e.message, true);
    return undefined;
  } finally {
    if (botao) { botao.disabled = false; botao.textContent = txt; }
  }
}

// ── diálogo genérico ────────────────────────────────────────────────────
const dlg = $('#dlg');
function abrirDialogo(html, aoAbrir) {
  dlg.innerHTML = html;
  dlg.showModal();
  const primeiro = $('input:not([type=hidden]), select, textarea', dlg);
  if (primeiro) primeiro.focus();
  if (aoAbrir) aoAbrir(dlg);
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true });
  });
}
function fecharDialogo(valor = '') { dlg.close(valor); }

async function confirmar(titulo, texto, { sim = 'Confirmar', perigo = false } = {}) {
  const r = await abrirDialogo(`
    <h2>${esc(titulo)}</h2><p>${texto}</p>
    <div class="botoes"><button type="button" data-fechar="">Voltar</button>
    <button type="button" class="${perigo ? 'perigo' : 'primario'}" data-fechar="sim">${esc(sim)}</button></div>`);
  return r === 'sim';
}
dlg.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fechar]');
  if (b) fecharDialogo(b.dataset.fechar);
});

// ── estado ──────────────────────────────────────────────────────────────
const S = { view: 'emitir', estado: null, cfg: null, escolhido: null, ultimoResultado: null, filtroNotas: null };

async function atualizarEstado() {
  S.estado = await api.estado();
  S.cfg = await api['config:campos']();
  const e = S.estado;
  const faixa = $('#faixa');
  const btn = $('#faixa-btn');
  if (e.ambiente === 'producao') {
    faixa.className = 'faixa producao';
    $('#faixa-txt').textContent = 'Emitindo notas reais';
    btn.textContent = 'Voltar ao modo de teste';
  } else {
    faixa.className = 'faixa teste';
    $('#faixa-txt').textContent = 'Modo de teste — as notas emitidas aqui não têm valor fiscal';
    btn.textContent = 'Passar a emitir notas reais';
  }
  btn.hidden = false;
  $('#nome-empresa').textContent = e.empresa || 'Empresa não configurada';
  $('#versao').textContent = `Versão ${e.versao}`;
  const pend = e.aVerificar + e.recusadas;
  $('#cont-notas').hidden = !pend;
  $('#cont-notas').textContent = pend;
  $('#cont-config').hidden = !e.pendencias.length;
  mostrarAtualizacao(e.atualizacao);
}

function mostrarAtualizacao(a) {
  const el = $('#atualizacao');
  if (!a || a.fase !== 'pronta') { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<p><strong>Atualização ${esc(a.versao)} pronta.</strong> Será instalada ao fechar o programa.</p>
    <button type="button" id="btn-reiniciar">Reiniciar agora</button>`;
  $('#btn-reiniciar').onclick = () => api['manut:instalarAtualizacao']();
}

$('#faixa-btn').addEventListener('click', async () => {
  if (S.estado.ambiente === 'producao') {
    await api['config:trocarAmbiente']('homologacao');
    toast('Modo de teste ativado.');
  } else {
    const ok = await confirmar('Passar a emitir notas reais?',
      'A partir de agora, cada nota emitida vale de verdade, vai para a Prefeitura e para a Receita, e só pode ser desfeita por cancelamento.<br><br>Faça isso só depois de ter emitido algumas notas de teste com sucesso e de a contadora ter conferido os dados fiscais.',
      { sim: 'Emitir notas reais' });
    if (!ok) return;
    const r = await tentar(() => api['config:trocarAmbiente']('producao'));
    if (r) toast('Pronto: as próximas notas serão reais.');
  }
  await atualizarEstado();
  render();
});

// ── navegação ───────────────────────────────────────────────────────────
$$('nav [data-view]').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.view)));
function irPara(view) {
  S.view = view;
  $$('nav [data-view]').forEach((b) => b.removeAttribute('aria-current'));
  $(`nav [data-view="${view}"]`).setAttribute('aria-current', 'page');
  render();
  $('#conteudo').scrollTop = 0;
}

async function render() {
  const el = $('#conteudo');
  const views = { emitir: viewEmitir, notas: viewNotas, pacientes: viewPacientes, relatorios: viewRelatorios, config: viewConfig, ajuda: viewAjuda };
  await views[S.view](el);
}

// ════════════════════════════════════════════════════════════════════════
// EMITIR
// ════════════════════════════════════════════════════════════════════════
async function viewEmitir(el) {
  const e = S.estado;
  const pend = e.pendencias;
  const cert = e.certificado;
  let avisos = '';
  if (pend.length) {
    avisos += `<div class="aviso vermelho"><strong>Falta configurar antes de emitir:</strong><ul>${pend.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      <p style="margin-top:.6rem"><button type="button" class="link" data-ir="config">Abrir Configurações</button></p></div>`;
  }
  if (cert && cert.diasParaVencer != null && cert.diasParaVencer <= 30) {
    avisos += `<div class="aviso ${cert.diasParaVencer < 0 ? 'vermelho' : 'ambar'}"><strong>O certificado digital ${cert.diasParaVencer < 0 ? 'venceu' : `vence em ${cert.diasParaVencer} dia(s)`}</strong> (${fmtData(cert.validoAte)}). Providencie a renovação com a certificadora e depois instale o novo em Configurações.</div>`;
  }
  if (e.aVerificar || e.recusadas) {
    avisos += `<div class="aviso ambar">${e.aVerificar ? `<strong>${e.aVerificar} nota(s) a verificar.</strong> ` : ''}${e.recusadas ? `<strong>${e.recusadas} nota(s) recusada(s) pela prefeitura.</strong> ` : ''}
      <button type="button" class="link" data-ir-pendentes>Ver e resolver</button></div>`;
  }

  el.innerHTML = `
    <div class="cabecalho"><div><h1>Emitir nota</h1><p>Escolha o paciente, confira o valor e emita. Para várias de uma vez, use a fila.</p></div></div>
    ${avisos}
    <div class="emitir">
      <section class="bloco" aria-labelledby="t-nova">
        <h2 id="t-nova">Nova nota</h2>
        <div class="campo busca" id="campo-busca">
          <label for="busca">Quem pagou a consulta</label>
          <input id="busca" type="search" class="grande" placeholder="Digite o nome ou o CPF" autocomplete="off"
                 role="combobox" aria-expanded="false" aria-controls="sugestoes">
          <ul id="sugestoes" class="sugestoes" role="listbox" hidden></ul>
          <div class="ajuda">Não encontrou? <button type="button" class="link" id="btn-novo-pac">Cadastrar novo paciente</button></div>
        </div>
        <div id="area-escolhido"></div>
        <div class="linha-campos">
          <div class="campo"><label for="valor">Valor (R$)</label><input id="valor" type="text" inputmode="decimal" class="grande num" placeholder="0,00"></div>
          <div class="campo"><label for="data">Data do atendimento</label><input id="data" type="date" class="grande" value="${hoje()}" max="${hoje()}"></div>
        </div>
        <div class="campo" id="dica-valor"></div>
        <div class="campo">
          <label>Texto que vai na nota</label>
          <div class="previa" id="previa">Escolha o paciente para ver o texto.</div>
          <div class="ajuda"><button type="button" class="link" id="btn-editar-texto">Alterar o texto só desta nota</button></div>
          <textarea id="texto" hidden aria-label="Texto da nota"></textarea>
        </div>
        <div class="botoes">
          <button type="button" class="primario grande" id="btn-emitir" ${pend.length ? 'disabled' : ''}>Emitir agora</button>
          <button type="button" class="grande" id="btn-fila">Adicionar à fila</button>
        </div>
      </section>

      <div>
        <section class="bloco" id="area-resultado" hidden></section>
        <section class="bloco" aria-labelledby="t-fila">
          <h2 id="t-fila">Fila para emitir</h2>
          <div id="fila"></div>
        </section>
      </div>
    </div>`;

  ligarBusca();
  $('#btn-novo-pac').onclick = async () => {
    const p = await dialogoPaciente({ nome: /\d/.test($('#busca').value) ? '' : $('#busca').value, cpf: /\d/.test($('#busca').value) ? $('#busca').value : '' });
    if (p) escolherPaciente(p);
  };
  $('#valor').addEventListener('input', atualizarPrevia);
  $('#data').addEventListener('change', atualizarPrevia);
  $('#btn-editar-texto').onclick = () => {
    const t = $('#texto');
    t.hidden = false;
    t.value = $('#previa').textContent;
    $('#previa').hidden = true;
    $('#btn-editar-texto').parentElement.hidden = true;
    t.focus();
  };
  $('#btn-emitir').onclick = (ev) => emitirAgora(ev.currentTarget);
  $('#btn-fila').onclick = (ev) => adicionarFila(ev.currentTarget);
  if (S.escolhido) escolherPaciente(S.escolhido, { manterValor: false });
  else $('#busca').focus();
  mostrarResultado();
  await renderFila();
}

function ligarBusca() {
  const input = $('#busca');
  const lista = $('#sugestoes');
  let itens = [];
  let sel = -1;
  let timer;
  const fechar = () => { lista.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const desenhar = () => {
    if (!itens.length) {
      lista.innerHTML = `<li aria-disabled="true"><span class="suave">Nenhum cadastro encontrado.</span></li>`;
    } else {
      lista.innerHTML = itens.map((p, i) => `<li role="option" id="op-${i}" data-i="${i}" aria-selected="${i === sel}">
        <span><strong>${esc(p.nome)}</strong>${p.benef_nome ? ` <small class="suave">· paciente ${esc(p.benef_nome)}</small>` : ''}</span>
        <small class="suave num">${fmtCpf(p.cpf)}</small></li>`).join('');
    }
    lista.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', sel >= 0 ? `op-${sel}` : '');
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { fechar(); return; }
    timer = setTimeout(async () => {
      itens = (await tentar(() => api['pacientes:listar']({ busca: q }))) || [];
      itens = itens.slice(0, 12);
      sel = itens.length ? 0 : -1;
      desenhar();
    }, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (lista.hidden) return;
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, itens.length - 1); desenhar(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); desenhar(); e.preventDefault(); }
    if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); escolherPaciente(itens[sel]); fechar(); }
    if (e.key === 'Escape') fechar();
  });
  lista.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); escolherPaciente(itens[Number(li.dataset.i)]); fechar(); }
  });
  input.addEventListener('blur', () => setTimeout(fechar, 100));
}

async function escolherPaciente(p, { manterValor = false } = {}) {
  S.escolhido = p;
  $('#campo-busca').hidden = true;
  $('#area-escolhido').innerHTML = `
    <div class="campo"><label>Quem pagou a consulta</label>
    <div class="escolhido"><div><strong>${esc(p.nome)}</strong>
      <small class="suave num">CPF ${fmtCpf(p.cpf)}${p.benef_nome ? ` · paciente: ${esc(p.benef_nome)}` : ''}</small></div>
      <div class="botoes"><button type="button" id="btn-edit-pac">Editar cadastro</button><button type="button" id="btn-trocar">Trocar</button></div></div></div>`;
  $('#btn-trocar').onclick = () => {
    S.escolhido = null;
    $('#area-escolhido').innerHTML = '';
    $('#campo-busca').hidden = false;
    $('#busca').value = '';
    $('#busca').focus();
    $('#dica-valor').textContent = '';
    atualizarPrevia();
  };
  $('#btn-edit-pac').onclick = async () => {
    const novo = await dialogoPaciente(await api['pacientes:obter'](p.id));
    if (novo) escolherPaciente(novo, { manterValor: true });
  };
  if (!manterValor) {
    const ultima = await tentar(() => api['notas:ultimaDoPaciente'](p.id));
    const padrao = p.valor_padrao || Number(String(S.cfg.valores.valor_padrao || '').replace(/\./g, '').replace(',', '.')) || '';
    const valor = (ultima && ultima.valor) || padrao;
    $('#valor').value = valorParaCampo(valor);
    $('#dica-valor').innerHTML = ultima
      ? `<span class="ajuda">Última nota: ${fmtMoeda(ultima.valor)} em ${fmtData(ultima.data_servico)}.</span>` : '';
  }
  atualizarPrevia();
  $('#valor').focus();
  $('#valor').select();
}

function atualizarPrevia() {
  const p = S.escolhido;
  const previa = $('#previa');
  if (!previa) return;
  if (!p) { previa.textContent = 'Escolha o paciente para ver o texto.'; return; }
  previa.textContent = montarTexto(S.cfg.valores.discriminacao_modelo, {
    data_servico: $('#data').value, valor: $('#valor').value.replace(/\./g, '').replace(',', '.'),
    tomador_nome: p.nome, benef_nome: p.benef_nome, benef_cpf: p.benef_cpf,
  });
}

function dadosDoFormulario() {
  if (!S.escolhido) { toast('Escolha quem pagou a consulta.', true); $('#busca').focus(); return null; }
  const t = $('#texto');
  return {
    paciente_id: S.escolhido.id,
    valor: $('#valor').value,
    data_servico: $('#data').value,
    discriminacao: t.hidden ? '' : t.value,
  };
}

function limparFormulario() {
  S.escolhido = null;
  render();
}

async function emitirAgora(botao) {
  const d = dadosDoFormulario();
  if (!d) return;
  await tentar(async () => {
    const r = await api['notas:rascunho'](d);
    botao.textContent = 'Enviando à prefeitura…';
    const n = await api['notas:emitir'](r.id);
    S.ultimoResultado = n;
    await atualizarEstado();
    if (n.status === 'autorizada') limparFormulario();
    else { mostrarResultado(); renderFila(); }
  }, { botao });
}

async function adicionarFila(botao) {
  const d = dadosDoFormulario();
  if (!d) return;
  const r = await tentar(() => api['notas:rascunho'](d), { botao });
  if (r) {
    toast(`${r.tomador_nome} adicionada à fila.`);
    await atualizarEstado();
    limparFormulario();
  }
}

function mostrarResultado() {
  const area = $('#area-resultado');
  const n = S.ultimoResultado;
  if (!area || !n) return;
  area.hidden = false;
  const classe = { autorizada: '', rejeitada: 'recusada', incerta: 'incerta', enviando: 'incerta', rascunho: 'incerta' }[n.status] ?? '';
  const titulo = {
    autorizada: `Nota nº ${esc(n.numero_nfse)} emitida`,
    rejeitada: 'A prefeitura recusou a nota',
    incerta: 'Sem confirmação da prefeitura',
    rascunho: 'Pronta para reenviar',
  }[n.status] || STATUS[n.status];
  const msgs = (n.mensagens || []).map((m) => `<li>${esc(m.descricao)}${m.campo ? ` <small>(${esc(m.campo)})</small>` : ''}</li>`).join('');
  let acoes = '';
  if (n.status === 'autorizada') {
    acoes = `<button type="button" class="primario" data-acao="pdf" data-id="${n.id}">Abrir PDF</button>
             <button type="button" data-acao="pasta" data-id="${n.id}">Mostrar na pasta</button>`;
  } else if (n.status === 'rejeitada') {
    acoes = `<button type="button" class="primario" data-acao="corrigir" data-id="${n.id}">Corrigir e reenviar</button>
             <button type="button" class="perigo" data-acao="apagar" data-id="${n.id}">Apagar</button>`;
  } else if (['incerta', 'enviando'].includes(n.status)) {
    acoes = `<button type="button" class="primario" data-acao="verificar" data-id="${n.id}">Verificar agora</button>`;
  } else if (n.status === 'rascunho') {
    acoes = `<button type="button" class="primario" data-acao="emitir" data-id="${n.id}">Emitir</button>`;
  }
  area.innerHTML = `
    <div class="resultado">
      <span class="carimbo novo ${classe}">${esc(STATUS[n.status].toUpperCase())}</span>
      <div><h2>${titulo}</h2>
        <p class="suave">${esc(n.tomador_nome)} · ${fmtMoeda(n.valor)} · atendimento em ${fmtData(n.data_servico)}</p></div>
    </div>
    ${msgs ? `<ul class="${n.status === 'rejeitada' ? 'msg-erro' : 'msg-ambar'}">${msgs}</ul>` : ''}
    ${n.status === 'rejeitada' ? '<p class="suave">Corrija o que a prefeitura apontou (no cadastro do paciente ou nos dados da nota) e reenvie. Se a mensagem falar de código, alíquota ou regime, fale com a contadora.</p>' : ''}
    <div class="botoes">${acoes}<button type="button" data-acao="fechar-resultado">Fechar</button></div>`;
}

async function renderFila() {
  const el = $('#fila');
  if (!el) return;
  const fila = await api['notas:listar']({ status: 'rascunho' });
  if (!fila.length) {
    el.innerHTML = `<p class="vazio">A fila está vazia. Use "Adicionar à fila" para juntar os atendimentos do dia e emitir todos de uma vez.</p>`;
    return;
  }
  const total = fila.reduce((s, n) => s + n.valor, 0);
  el.innerHTML = `
    <ul class="fila">${fila.map((n) => `<li>
      <span><strong>${esc(n.tomador_nome)}</strong><br><small class="suave">${fmtData(n.data_servico)}${n.mensagens.length ? ` · ${esc(n.mensagens[0].descricao)}` : ''}</small></span>
      <span class="num">${fmtMoeda(n.valor)}</span>
      <button type="button" class="x" data-acao="tirar-fila" data-id="${n.id}" aria-label="Tirar ${esc(n.tomador_nome)} da fila">✕</button></li>`).join('')}</ul>
    <p class="num" style="margin-top:.75rem"><strong>${fila.length} nota(s)</strong> · total ${fmtMoeda(total)}</p>
    <div id="progresso-lote" hidden><progress max="${fila.length}" value="0"></progress><p class="suave" id="progresso-txt"></p></div>
    <div class="botoes"><button type="button" class="primario" id="btn-lote" ${S.estado.pendencias.length ? 'disabled' : ''}>Emitir todas (${fila.length})</button></div>`;
  $('#btn-lote').onclick = (ev) => emitirLote(fila.map((n) => n.id), ev.currentTarget);
}

async function emitirLote(ids, botao) {
  const ok = await confirmar(`Emitir ${ids.length} nota(s)?`,
    `${S.estado.ambiente === 'producao' ? 'Serão notas <strong>reais</strong>.' : 'Modo de teste: as notas não terão valor fiscal.'} Não feche o programa até terminar.`,
    { sim: 'Emitir todas' });
  if (!ok) return;
  $('#progresso-lote').hidden = false;
  botao.disabled = true;
  const res = await tentar(() => api['notas:lote'](ids));
  await atualizarEstado();
  if (res) {
    const partes = [`${res.autorizadas} emitida(s)`];
    if (res.rejeitadas) partes.push(`${res.rejeitadas} recusada(s)`);
    if (res.incertas) partes.push(`${res.incertas} a verificar`);
    toast(`Fila concluída: ${partes.join(', ')}.${res.rejeitadas || res.incertas ? '\nVeja em "Notas emitidas" o que precisa de atenção.' : ''}`,
      !!(res.erroGeral), 9000);
    if (res.erroGeral) toast(res.erroGeral, true);
  }
  render();
}

api.on('lote:progresso', (p) => {
  const bar = $('#progresso-lote progress');
  if (bar) bar.value = p.atual;
  const t = $('#progresso-txt');
  if (t) t.textContent = `${p.atual} de ${p.total}: ${p.nota.tomador_nome} — ${STATUS[p.nota.status]}`;
});

// ════════════════════════════════════════════════════════════════════════
// NOTAS
// ════════════════════════════════════════════════════════════════════════
async function viewNotas(el) {
  const f = S.filtroNotas || (S.filtroNotas = { mes: mesAtual(), status: '', busca: '' });
  el.innerHTML = `
    <div class="cabecalho"><div><h1>Notas emitidas</h1><p>Abra, reenvie ou cancele notas. As que precisam de atenção aparecem em amarelo ou vermelho.</p></div></div>
    <div class="filtros">
      <div class="campo"><label for="f-mes">Mês do atendimento</label><input id="f-mes" type="month" value="${esc(f.mes)}"></div>
      <div class="campo"><label for="f-status">Situação</label><select id="f-status">
        <option value="">Todas</option><option value="pendentes">Precisam de atenção</option>
        <option value="autorizada">Emitidas</option><option value="cancelada">Canceladas</option></select></div>
      <div class="campo" style="flex:1;min-width:220px"><label for="f-busca">Buscar</label><input id="f-busca" type="search" placeholder="Nome ou número da nota" value="${esc(f.busca)}"></div>
    </div>
    <div class="resumo" id="resumo-notas"></div>
    <div id="tabela-notas"></div>`;
  $('#f-status').value = f.status;
  const recarregar = () => {
    f.mes = $('#f-mes').value;
    f.status = $('#f-status').value;
    f.busca = $('#f-busca').value;
    desenharNotas();
  };
  $('#f-mes').onchange = recarregar;
  $('#f-status').onchange = recarregar;
  let t;
  $('#f-busca').oninput = () => { clearTimeout(t); t = setTimeout(recarregar, 250); };
  await desenharNotas();
}

async function desenharNotas() {
  const f = S.filtroNotas;
  const [ano, mes] = (f.mes || '').split('-');
  const filtro = { status: f.status, busca: f.busca };
  if (f.status !== 'pendentes' && ano) Object.assign(filtro, { ano, mes });
  const notas = (await tentar(() => api['notas:listar'](filtro))) || [];
  const emitidas = notas.filter((n) => n.status === 'autorizada');
  $('#resumo-notas').innerHTML = `
    <div><strong class="num">${emitidas.length}</strong><span>notas emitidas</span></div>
    <div><strong class="num">${fmtMoeda(emitidas.reduce((s, n) => s + n.valor, 0))}</strong><span>total emitido</span></div>`;
  if (!notas.length) {
    $('#tabela-notas').innerHTML = `<div class="bloco vazio">Nenhuma nota com esses filtros.</div>`;
    return;
  }
  $('#tabela-notas').innerHTML = `<div class="tabela"><table>
    <thead><tr><th>Nº</th><th>Atendimento</th><th>Quem pagou</th><th class="valor">Valor</th><th>Situação</th><th class="valor">Ações</th></tr></thead>
    <tbody>${notas.map(linhaNota).join('')}</tbody></table></div>`;
}

function linhaNota(n) {
  const msgs = n.mensagens.map((m) => esc(m.descricao)).join('<br>');
  const b = (acao, txt, cls = '') => `<button type="button" class="${cls}" data-acao="${acao}" data-id="${n.id}">${txt}</button>`;
  const acoes = {
    autorizada: b('pdf', 'PDF') + b('pasta', 'Pasta') + b('cancelar', 'Cancelar', 'perigo'),
    cancelada: b('pasta', 'Pasta'),
    rejeitada: b('corrigir', 'Corrigir e reenviar', 'primario') + b('apagar', 'Apagar', 'perigo'),
    incerta: b('verificar', 'Verificar', 'primario'),
    enviando: b('verificar', 'Verificar', 'primario'),
    rascunho: b('emitir', 'Emitir', 'primario') + b('corrigir', 'Editar') + b('apagar', 'Apagar', 'perigo'),
  }[n.status];
  return `<tr>
    <td class="num">${esc(n.numero_nfse || '—')}</td>
    <td class="num">${fmtData(n.data_servico)}</td>
    <td><strong>${esc(n.tomador_nome)}</strong>${n.benef_nome ? `<br><small class="suave">paciente: ${esc(n.benef_nome)}</small>` : ''}</td>
    <td class="valor num">${fmtMoeda(n.valor)}</td>
    <td><span class="selo ${n.status}">${STATUS[n.status]}</span>
      ${msgs ? `<div class="${n.status === 'rejeitada' ? 'msg-erro' : 'msg-ambar'}">${msgs}</div>` : ''}
      ${n.status === 'cancelada' && n.motivo_cancelamento ? `<div class="msg-ambar">${esc(n.motivo_cancelamento)}</div>` : ''}</td>
    <td><div class="acoes">${acoes}</div></td></tr>`;
}

// Ações de nota (usadas em Emitir e em Notas)
document.addEventListener('click', async (e) => {
  const ir = e.target.closest('[data-ir]');
  if (ir) { irPara(ir.dataset.ir); return; }
  if (e.target.closest('[data-ir-pendentes]')) { S.filtroNotas = { mes: mesAtual(), status: 'pendentes', busca: '' }; irPara('notas'); return; }
  const b = e.target.closest('[data-acao]');
  if (!b || b.closest('dialog')) return;
  const id = Number(b.dataset.id);
  const acao = b.dataset.acao;
  const depois = async (n) => {
    await atualizarEstado();
    if (n && S.view === 'emitir') { S.ultimoResultado = n; mostrarResultado(); renderFila(); }
    else if (S.view === 'notas') desenharNotas();
    else render();
  };
  switch (acao) {
    case 'fechar-resultado': S.ultimoResultado = null; $('#area-resultado').hidden = true; break;
    case 'pdf': await tentar(() => api['notas:abrirPdf'](id), { botao: b }); break;
    case 'pasta': await tentar(() => api['notas:mostrarNaPasta'](id)); break;
    case 'tirar-fila': await tentar(() => api['notas:excluir'](id)); await depois(null); break;
    case 'apagar':
      if (await confirmar('Apagar esta nota?', 'Ela ainda não foi emitida, então pode ser apagada sem problema.', { sim: 'Apagar', perigo: true })) {
        await tentar(() => api['notas:excluir'](id));
        if (S.ultimoResultado && S.ultimoResultado.id === id) S.ultimoResultado = null;
        await depois(null);
      }
      break;
    case 'emitir': {
      const n = await tentar(() => api['notas:emitir'](id), { botao: b });
      if (n) { toast(n.status === 'autorizada' ? `Nota nº ${n.numero_nfse} emitida.` : `Situação: ${STATUS[n.status]}.`, n.status === 'rejeitada'); await depois(n); }
      break;
    }
    case 'verificar': {
      const n = await tentar(() => api['notas:tentarNovamente'](id), { botao: b });
      if (n) {
        const msg = { autorizada: `Confirmado: nota nº ${n.numero_nfse} emitida.`, rejeitada: 'A prefeitura recusou a nota. Veja o motivo.',
          incerta: 'Ainda sem resposta da prefeitura. Tente de novo em alguns minutos.' }[n.status] || `Situação: ${STATUS[n.status]}.`;
        toast(msg, n.status !== 'autorizada');
        await depois(n);
      }
      break;
    }
    case 'corrigir': { const n = await dialogoCorrigir(id); if (n) await depois(n); break; }
    case 'cancelar': { const n = await dialogoCancelar(id); if (n) await depois(n); break; }
    default: break;
  }
});

async function dialogoCorrigir(id) {
  const n = await tentar(() => api['notas:obter'](id));
  if (!n) return null;
  let resultado = null;
  await abrirDialogo(`
    <h2>${n.status === 'rejeitada' ? 'Corrigir e reenviar' : 'Editar nota'}</h2>
    ${n.mensagens.length ? `<div class="aviso ${n.status === 'rejeitada' ? 'vermelho' : 'ambar'}"><ul>${n.mensagens.map((m) => `<li>${esc(m.descricao)}</li>`).join('')}</ul></div>` : ''}
    <p><strong>${esc(n.tomador_nome)}</strong> · CPF ${fmtCpf(n.tomador_cpf)}<br>
      <small class="suave">Nome ou CPF errado? Corrija no cadastro: <button type="button" class="link" id="d-edit-pac">editar cadastro</button>. A correção vale para esta nota.</small></p>
    <div class="linha-campos">
      <div class="campo"><label for="d-valor">Valor (R$)</label><input id="d-valor" type="text" class="num" value="${valorParaCampo(n.valor)}"></div>
      <div class="campo"><label for="d-data">Data do atendimento</label><input id="d-data" type="date" value="${n.data_servico}" max="${hoje()}"></div>
    </div>
    <div class="campo"><label for="d-texto">Texto da nota</label><textarea id="d-texto">${esc(n.discriminacao)}</textarea></div>
    <div class="botoes"><button type="button" data-fechar="">Voltar</button>
      <button type="button" id="d-salvar">Só salvar</button>
      <button type="button" class="primario" id="d-enviar" ${S.estado.pendencias.length ? 'disabled' : ''}>Salvar e emitir</button></div>`,
  (d) => {
    $('#d-edit-pac', d).onclick = async () => {
      const p = await api['pacientes:obter'](n.paciente_id);
      fecharDialogo('');
      await dialogoPaciente(p);
    };
    const salvar = () => api['notas:editar'](id, { valor: $('#d-valor', d).value, data_servico: $('#d-data', d).value, discriminacao: $('#d-texto', d).value });
    $('#d-salvar', d).onclick = async (ev) => {
      const r = await tentar(salvar, { botao: ev.currentTarget });
      if (r) { resultado = r; toast('Alterações salvas.'); fecharDialogo('ok'); }
    };
    $('#d-enviar', d).onclick = async (ev) => {
      const r = await tentar(async () => { await salvar(); return api['notas:emitir'](id); }, { botao: ev.currentTarget });
      if (r) {
        resultado = r;
        toast(r.status === 'autorizada' ? `Nota nº ${r.numero_nfse} emitida.` : `Situação: ${STATUS[r.status]}.`, r.status !== 'autorizada');
        fecharDialogo('ok');
      }
    };
  });
  return resultado;
}

async function dialogoCancelar(id) {
  let resultado = null;
  await abrirDialogo(`
    <h2>Cancelar nota</h2>
    <p>O cancelamento é enviado à prefeitura e não pode ser desfeito. Se for só para corrigir algo, emita depois uma nova nota correta.</p>
    <div class="campo"><label for="c-cod">Motivo</label><select id="c-cod">
      <option value="1">Erro na emissão (valor, paciente ou data errados)</option>
      <option value="2">Serviço não prestado</option><option value="9">Outro</option></select></div>
    <div class="campo"><label for="c-motivo">Explique em poucas palavras</label>
      <textarea id="c-motivo" placeholder="Ex.: Valor digitado errado; nota correta será emitida em seguida."></textarea>
      <div class="ajuda" id="c-cont">Mínimo de 15 letras.</div></div>
    <div class="botoes"><button type="button" data-fechar="">Voltar</button>
      <button type="button" class="perigo" id="c-ok">Cancelar nota</button></div>`,
  (d) => {
    $('#c-motivo', d).oninput = (e) => { $('#c-cont', d).textContent = `${e.target.value.trim().length} de no mínimo 15 letras.`; };
    $('#c-ok', d).onclick = async (ev) => {
      const r = await tentar(() => api['notas:cancelar'](id, { codigoMotivo: Number($('#c-cod', d).value), motivo: $('#c-motivo', d).value }),
        { botao: ev.currentTarget });
      if (r) { resultado = r; toast('Nota cancelada na prefeitura.'); fecharDialogo('ok'); }
    };
  });
  return resultado;
}

// ════════════════════════════════════════════════════════════════════════
// PACIENTES
// ════════════════════════════════════════════════════════════════════════
async function viewPacientes(el) {
  el.innerHTML = `
    <div class="cabecalho"><div><h1>Pacientes</h1><p>Cadastre quem paga as consultas. Quando quem paga não é o paciente (ex.: pai e filho), informe os dois.</p></div>
      <div class="botoes"><button type="button" id="btn-importar">Importar planilha</button><button type="button" class="primario" id="btn-novo">Novo paciente</button></div></div>
    <div class="filtros"><div class="campo" style="flex:1"><label for="p-busca">Buscar</label><input id="p-busca" type="search" placeholder="Nome ou CPF"></div>
      <label class="check" style="margin-bottom:.6rem"><input type="checkbox" id="p-inativos"> Mostrar inativos</label></div>
    <div id="tabela-pac"></div>`;
  const desenhar = async () => {
    const lista = (await tentar(() => api['pacientes:listar']({ busca: $('#p-busca').value, incluirInativos: $('#p-inativos').checked }))) || [];
    $('#tabela-pac').innerHTML = !lista.length
      ? `<div class="bloco vazio">Nenhum paciente${$('#p-busca').value ? ' encontrado' : ' cadastrado ainda. Use "Novo paciente" ou "Importar planilha"'}.</div>`
      : `<div class="tabela"><table><thead><tr><th>Quem paga</th><th>CPF</th><th>Paciente (se outro)</th><th class="valor">Valor padrão</th><th>Última nota</th><th class="valor">Ações</th></tr></thead>
        <tbody>${lista.map((p) => `<tr${p.ativo ? '' : ' style="opacity:.55"'}>
          <td><strong>${esc(p.nome)}</strong>${p.ativo ? '' : ' <small>(inativo)</small>'}</td><td class="num">${fmtCpf(p.cpf)}</td>
          <td>${esc(p.benef_nome || '')}</td><td class="valor num">${p.valor_padrao ? fmtMoeda(p.valor_padrao) : '—'}</td>
          <td class="num">${fmtData(p.ultima_nota) || '—'}</td>
          <td><div class="acoes"><button type="button" data-pac-editar="${p.id}">Editar</button>
            <button type="button" class="primario" data-pac-emitir="${p.id}">Emitir nota</button></div></td></tr>`).join('')}</tbody></table></div>`;
  };
  let t;
  $('#p-busca').oninput = () => { clearTimeout(t); t = setTimeout(desenhar, 200); };
  $('#p-inativos').onchange = desenhar;
  $('#btn-novo').onclick = async () => { if (await dialogoPaciente({})) desenhar(); };
  $('#btn-importar').onclick = async () => {
    const ok = await confirmar('Importar planilha de pacientes',
      'Use um arquivo CSV (Excel: "Salvar como" → "CSV separado por ponto e vírgula") com as colunas <strong>nome</strong> e <strong>cpf</strong> na primeira linha. As colunas <strong>email</strong> e <strong>valor</strong> são opcionais. CPFs já cadastrados são ignorados.',
      { sim: 'Escolher arquivo' });
    if (!ok) return;
    const r = await tentar(() => api['pacientes:importar']());
    if (r) {
      toast(`${r.importados} paciente(s) importado(s).${r.ignorados.length ? `\n${r.ignorados.length} linha(s) ignorada(s):\n${r.ignorados.slice(0, 8).join('\n')}` : ''}`,
        false, 12000);
      desenhar();
    }
  };
  $('#tabela-pac').onclick = async (e) => {
    const ed = e.target.closest('[data-pac-editar]');
    const em = e.target.closest('[data-pac-emitir]');
    if (ed) { if (await dialogoPaciente(await api['pacientes:obter'](Number(ed.dataset.pacEditar)))) desenhar(); }
    if (em) { S.escolhido = await api['pacientes:obter'](Number(em.dataset.pacEmitir)); irPara('emitir'); }
  };
  await desenhar();
  $('#p-busca').focus();
}

async function dialogoPaciente(p = {}) {
  let salvo = null;
  const temBenef = !!p.benef_nome;
  const temEnd = !!(p.cep || p.logradouro);
  await abrirDialogo(`
    <h2>${p.id ? 'Editar cadastro' : 'Novo paciente'}</h2>
    <div class="campo"><label for="pc-nome">Nome completo de quem paga</label><input id="pc-nome" type="text" value="${esc(p.nome)}"></div>
    <div class="linha-campos">
      <div class="campo"><label for="pc-cpf">CPF de quem paga</label><input id="pc-cpf" type="text" inputmode="numeric" class="num" value="${esc(fmtCpf(p.cpf) || p.cpf || '')}"></div>
      <div class="campo"><label for="pc-valor">Valor da consulta (R$)</label><input id="pc-valor" type="text" inputmode="decimal" class="num" value="${valorParaCampo(p.valor_padrao)}" placeholder="opcional"></div>
    </div>
    <div class="linha-campos">
      <div class="campo"><label for="pc-email">E-mail</label><input id="pc-email" type="email" value="${esc(p.email)}" placeholder="opcional"></div>
      <div class="campo"><label for="pc-tel">Telefone</label><input id="pc-tel" type="text" value="${esc(p.telefone)}" placeholder="opcional"></div>
    </div>
    <label class="check campo"><input type="checkbox" id="pc-tem-benef" ${temBenef ? 'checked' : ''}> O paciente é outra pessoa (ex.: filho, cônjuge, pai)</label>
    <div id="pc-benef" ${temBenef ? '' : 'hidden'}>
      <div class="campo"><label for="pc-bnome">Nome do paciente</label><input id="pc-bnome" type="text" value="${esc(p.benef_nome)}"></div>
      <div class="linha-campos">
        <div class="campo"><label for="pc-bcpf">CPF do paciente</label><input id="pc-bcpf" type="text" class="num" value="${esc(fmtCpf(p.benef_cpf))}" placeholder="se tiver"></div>
        <div class="campo"><label for="pc-bnasc">Nascimento do paciente</label><input id="pc-bnasc" type="date" value="${esc(p.benef_nasc)}"></div>
      </div>
      <p class="ajuda suave">O nome do paciente aparece no texto da nota, para quem paga poder deduzir no Imposto de Renda.</p>
    </div>
    <details class="avancado" ${temEnd ? 'open' : ''}><summary>Endereço (opcional)</summary>
      <div class="linha-campos">
        <div class="campo"><label for="pc-cep">CEP</label><input id="pc-cep" type="text" value="${esc(p.cep)}"></div>
        <div class="campo"><label for="pc-num">Número</label><input id="pc-num" type="text" value="${esc(p.numero)}"></div>
      </div>
      <div class="campo"><label for="pc-log">Rua</label><input id="pc-log" type="text" value="${esc(p.logradouro)}"></div>
      <div class="linha-campos">
        <div class="campo"><label for="pc-comp">Complemento</label><input id="pc-comp" type="text" value="${esc(p.complemento)}"></div>
        <div class="campo"><label for="pc-bairro">Bairro</label><input id="pc-bairro" type="text" value="${esc(p.bairro)}"></div>
      </div>
      <p class="ajuda suave">Só é enviado se CEP, rua, número e bairro estiverem preenchidos.</p>
    </details>
    ${p.id ? `<label class="check campo" style="margin-top:1rem"><input type="checkbox" id="pc-ativo" ${p.ativo === 0 ? '' : 'checked'}> Cadastro ativo</label>` : ''}
    <div class="botoes"><button type="button" data-fechar="">Voltar</button><button type="button" class="primario" id="pc-salvar">Salvar</button></div>`,
  (d) => {
    $('#pc-tem-benef', d).onchange = (e) => { $('#pc-benef', d).hidden = !e.target.checked; };
    $('#pc-cpf', d).onblur = (e) => {
      const ok = !e.target.value || cpfValido(e.target.value);
      e.target.classList.toggle('invalido', !ok);
      if (ok && e.target.value) e.target.value = fmtCpf(e.target.value);
    };
    $('#pc-salvar', d).onclick = async (ev) => {
      const benef = $('#pc-tem-benef', d).checked;
      const dados = {
        id: p.id, nome: $('#pc-nome', d).value, cpf: $('#pc-cpf', d).value, valor_padrao: $('#pc-valor', d).value,
        email: $('#pc-email', d).value, telefone: $('#pc-tel', d).value,
        benef_nome: benef ? $('#pc-bnome', d).value : '', benef_cpf: benef ? $('#pc-bcpf', d).value : '',
        benef_nasc: benef ? $('#pc-bnasc', d).value : '',
        cep: $('#pc-cep', d).value, numero: $('#pc-num', d).value, logradouro: $('#pc-log', d).value,
        complemento: $('#pc-comp', d).value, bairro: $('#pc-bairro', d).value,
      };
      if (p.id) dados.ativo = $('#pc-ativo', d).checked ? 1 : 0;
      const r = await tentar(() => api['pacientes:salvar'](dados), { botao: ev.currentTarget });
      if (r) { salvo = r; toast('Cadastro salvo.'); fecharDialogo('ok'); }
    };
  });
  return salvo;
}

// ════════════════════════════════════════════════════════════════════════
// RELATÓRIOS
// ════════════════════════════════════════════════════════════════════════
async function viewRelatorios(el) {
  const d = new Date();
  const mesAnterior = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const anoDmed = d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear();
  el.innerHTML = `
    <div class="cabecalho"><div><h1>Contadora e DMED</h1><p>Arquivos prontos para enviar.</p></div></div>
    ${S.estado.ambiente !== 'producao' ? '<div class="aviso ambar">Você está no modo de teste: o pacote do mês mostra as notas de teste. A DMED considera só notas reais.</div>' : ''}
    <section class="bloco">
      <h2>Pacote do mês para a contadora</h2>
      <p>Gera um arquivo .zip com a planilha das notas do mês (incluindo canceladas) e os PDFs e XMLs de cada uma. Envie para a contadora todo começo de mês.</p>
      <div class="filtros"><div class="campo"><label for="r-mes">Mês</label>
        <input id="r-mes" type="month" value="${mesAnterior.getFullYear()}-${pad(mesAnterior.getMonth() + 1)}"></div>
        <button type="button" class="primario" id="btn-pacote">Gerar pacote</button></div>
    </section>
    <section class="bloco">
      <h2>Base para a DMED</h2>
      <p>A DMED é entregue uma vez por ano (até o fim de fevereiro) e informa à Receita quanto cada CPF pagou. Esta planilha soma o ano inteiro por quem pagou e por paciente, para a contadora preencher a declaração.</p>
      <div class="filtros"><div class="campo"><label for="r-ano">Ano</label><input id="r-ano" type="text" inputmode="numeric" class="num" value="${anoDmed}" style="width:8rem"></div>
        <button type="button" class="primario" id="btn-dmed">Gerar planilha</button></div>
    </section>`;
  $('#btn-pacote').onclick = async (ev) => {
    const [ano, mes] = $('#r-mes').value.split('-').map(Number);
    const r = await tentar(() => api['relatorios:mensal'](ano, mes), { botao: ev.currentTarget });
    if (r) toast(`Pacote salvo: ${r.notas} nota(s), total ${fmtMoeda(r.total)}.`);
  };
  $('#btn-dmed').onclick = async (ev) => {
    const r = await tentar(() => api['relatorios:dmed'](Number($('#r-ano').value)), { botao: ev.currentTarget });
    if (r) toast(`Planilha salva: ${r.linhas} pagador(es), total ${fmtMoeda(r.total)}.`);
  };
}

// ════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÕES
// ════════════════════════════════════════════════════════════════════════
function htmlCampo(c, v) {
  const id = `cfg-${c.chave}`;
  const ajuda = c.ajuda ? `<div class="ajuda">${esc(c.ajuda)}</div>` : '';
  if (c.tipo === 'checkbox') {
    return `<div class="campo"><label class="check"><input type="checkbox" id="${id}" data-chave="${c.chave}" ${v === '1' ? 'checked' : ''}> ${esc(c.rotulo)}</label>${ajuda}</div>`;
  }
  let input;
  if (c.tipo === 'select') {
    input = `<select id="${id}" data-chave="${c.chave}">${c.obrigatorio && !v ? '<option value="">Escolha…</option>' : ''}${c.opcoes.map(([val, txt]) => `<option value="${val}" ${String(v) === val ? 'selected' : ''}>${esc(txt)}</option>`).join('')}</select>`;
  } else if (c.tipo === 'textarea') {
    input = `<textarea id="${id}" data-chave="${c.chave}">${esc(v)}</textarea>`;
  } else if (c.tipo === 'folder') {
    input = `<div class="botoes"><input id="${id}" type="text" data-chave="${c.chave}" value="${esc(v)}" readonly style="flex:1;min-width:260px" placeholder="Nenhuma pasta escolhida">
      <button type="button" id="btn-pasta-backup">Escolher pasta</button></div>`;
  } else {
    const valor = c.tipo === 'cnpj' ? fmtCnpj(v) || v : v;
    input = `<input id="${id}" type="text" data-chave="${c.chave}" value="${esc(valor)}" ${c.tipo === 'money' || c.tipo === 'int' ? 'class="num" inputmode="decimal"' : ''}>`;
  }
  return `<div class="campo"><label for="${id}">${esc(c.rotulo)}${c.obrigatorio ? '' : ' <small class="suave">(opcional)</small>'}</label>${input}${ajuda}</div>`;
}

async function viewConfig(el) {
  const { campos, grupos, valores } = S.cfg;
  const e = S.estado;
  const cert = e.certificado;
  const grupo = (g) => {
    const normais = campos.filter((c) => c.grupo === g && !c.avancado);
    const avanc = campos.filter((c) => c.grupo === g && c.avancado);
    return `<section class="bloco"><h2>${esc(grupos[g])}</h2>
      ${g === 'fiscal' ? '<p class="suave">Mostre esta seção à contadora. Os valores sugeridos precisam ser confirmados por ela antes de emitir notas reais.</p>' : ''}
      ${normais.map((c) => htmlCampo(c, valores[c.chave])).join('')}
      ${avanc.length ? `<details class="avancado"${g === 'fiscal' ? ' open' : ''}><summary>${g === 'fiscal' ? 'Códigos (contadora)' : 'Opções avançadas'}</summary>${avanc.map((c) => htmlCampo(c, valores[c.chave])).join('')}</details>` : ''}
      ${g === 'backup' ? `<div class="botoes"><button type="button" id="btn-backup">Fazer backup agora</button><button type="button" id="btn-restaurar">Restaurar um backup…</button></div>` : ''}
    </section>`;
  };
  el.innerHTML = `
    <div class="cabecalho"><div><h1>Configurações</h1><p>Preencha uma vez. Depois só volte aqui para renovar o certificado ou ajustar algo que a contadora pedir.</p></div></div>
    ${e.pendencias.length ? `<div class="aviso vermelho"><strong>Pendências:</strong><ul>${e.pendencias.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : '<div class="aviso verde"><strong>Tudo configurado.</strong></div>'}
    <section class="bloco">
      <h2>Certificado digital (e-CNPJ A1)</h2>
      ${cert ? `<p><strong>${esc(cert.titular)}</strong><br><span class="num">CNPJ ${fmtCnpj(cert.cnpj) || '—'}</span><br>
        Válido até <strong>${fmtData(cert.validoAte)}</strong> ${cert.diasParaVencer < 0 ? '<span class="selo rejeitada">vencido</span>' : cert.diasParaVencer <= 30 ? `<span class="selo incerta">vence em ${cert.diasParaVencer} dias</span>` : `<span class="selo autorizada">${cert.diasParaVencer} dias restantes</span>`}</p>`
      : '<p>Nenhum certificado instalado ainda.</p>'}
      <div class="linha-campos" style="align-items:end">
        <div class="campo"><label for="cert-senha">Senha do certificado</label><input id="cert-senha" type="password" autocomplete="off"></div>
        <div class="campo"><button type="button" class="${cert ? '' : 'primario'}" id="btn-cert">${cert ? 'Trocar certificado…' : 'Escolher arquivo do certificado…'}</button></div>
      </div>
      <p class="ajuda suave">Digite a senha primeiro e depois escolha o arquivo .pfx ou .p12 que a certificadora enviou. A senha fica guardada de forma protegida pelo Windows.</p>
    </section>
    <form id="form-config">${['empresa', 'fiscal', 'emissao', 'backup'].map(grupo).join('')}</form>
    <section class="bloco">
      <h2>Suporte</h2>
      <p>Se algo der errado, gere o arquivo de diagnóstico e envie para quem dá suporte ao programa. Nomes e CPFs de pacientes ficam ocultos nesse arquivo.</p>
      <div class="botoes"><button type="button" id="btn-diag">Gerar arquivo de diagnóstico</button><button type="button" id="btn-docs">Abrir pasta das notas</button></div>
      <p class="suave" style="margin-top:.75rem">As notas ficam em: <span class="num">${esc(e.pastaDocumentos)}</span></p>
    </section>
    <div class="barra-salvar">
      <button type="button" class="primario grande" id="btn-salvar-cfg">Salvar configurações</button></div>`;

  $('#btn-cert').onclick = async (ev) => {
    const senha = $('#cert-senha').value;
    if (!senha) { toast('Digite primeiro a senha do certificado.', true); $('#cert-senha').focus(); return; }
    await salvarConfig(false);
    const r = await tentar(() => api['config:instalarCertificado'](senha), { botao: ev.currentTarget });
    if (r) { toast(`Certificado instalado: ${r.titular}. Válido até ${fmtData(r.validoAte)}.`); await atualizarEstado(); render(); }
  };
  $('#btn-pasta-backup').onclick = async () => {
    const p = await tentar(() => api['manut:escolherPastaBackup']());
    if (p) { $('#cfg-backup_pasta').value = p; S.cfg.valores.backup_pasta = p; }
  };
  $('#btn-backup').onclick = async (ev) => {
    const f = await tentar(() => api['manut:backupAgora'](), { botao: ev.currentTarget });
    if (f) toast('Backup feito.');
  };
  $('#btn-restaurar').onclick = () => tentar(() => api['manut:restaurar']());
  $('#btn-diag').onclick = async (ev) => { const f = await tentar(() => api['manut:diagnostico'](), { botao: ev.currentTarget }); if (f) toast('Arquivo salvo na Área de Trabalho.'); };
  $('#btn-docs').onclick = () => tentar(() => api['manut:abrirDocumentos']());
  $('#btn-salvar-cfg').onclick = () => salvarConfig(true);
}

async function salvarConfig(avisar) {
  const valores = {};
  $$('#form-config [data-chave]').forEach((i) => {
    let v = i.type === 'checkbox' ? (i.checked ? '1' : '0') : i.value.trim();
    if (i.dataset.chave === 'cnpj') v = dig(v);
    valores[i.dataset.chave] = v;
  });
  const pend = await tentar(() => api['config:salvar'](valores));
  if (pend === undefined) return;
  await atualizarEstado();
  if (avisar) {
    toast(pend.length ? `Salvo. Ainda falta:\n${pend.join('\n')}` : 'Configurações salvas. Tudo pronto para emitir.', false, 8000);
    render();
  }
}

// ════════════════════════════════════════════════════════════════════════
// AJUDA
// ════════════════════════════════════════════════════════════════════════
function viewAjuda(el) {
  el.innerHTML = `<div class="ajuda-texto">${AJUDA_HTML}</div>`;
}

// ── início ──────────────────────────────────────────────────────────────
api.on('atualizacao', (a) => mostrarAtualizacao(a));
api.on('reconciliado', async (n) => {
  toast(`${n} nota(s) pendente(s) da última vez foram verificadas com a prefeitura.`);
  await atualizarEstado();
  // Não redesenha a tela inteira (apagaria o que a pessoa está digitando); só atualiza listas.
  if (S.view === 'notas') desenharNotas();
  else if (S.view === 'emitir') renderFila();
});

(async () => {
  try {
    await atualizarEstado();
    if (S.estado.pendencias.length && !S.estado.certificado && !S.estado.empresa) S.view = 'config';
    irPara(S.view);
  } catch (e) {
    $('#conteudo').innerHTML = `<div class="aviso vermelho"><strong>Erro ao iniciar:</strong> ${esc(e.message)}</div>`;
  }
})();
