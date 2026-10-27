'use strict';
// Demonstração/screenshots em desenvolvimento: dados fictícios + prefeitura simulada.
// Uso: NFSE_SHOTS=/pasta electron scripts/demo.js   (sem NFSE_SHOTS abre o programa para explorar)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const base = process.env.NFSE_DADOS || fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-demo-'));
process.env.NFSE_DADOS = base;
process.env.NFSE_SIMULAR = process.env.NFSE_SIMULAR || '1';

async function semear() {
  const { Database } = require('../src/main/db');
  const { Config } = require('../src/main/config');
  const { GerenciadorCertificado } = require('../src/main/cert');
  const { Emissor } = require('../src/main/emissor');
  const { Pacientes } = require('../src/main/pacientes');
  const h = require('../test/helpers');
  const dados = path.join(base, 'dados');
  fs.mkdirSync(dados, { recursive: true });
  if (fs.existsSync(path.join(dados, 'notas.db'))) return;
  const db = await Database.open(path.join(dados, 'notas.db'));
  const config = new Config(db);
  config.setMany({ razao_social: 'CLÍNICA DRA. EXEMPLO LTDA', cnpj: h.CNPJ, inscricao_municipal: '1234567', opcao_simples: '3', valor_padrao: '450,00' });
  const certificado = new GerenciadorCertificado({ config, caminhoPfx: path.join(dados, 'certificado.pfx'), cofre: h.cofreTeste });
  const pfx = path.join(base, 'teste.pfx');
  fs.writeFileSync(pfx, h.criarPfx());
  certificado.instalar(pfx, 'segredo');
  const pac = new Pacientes(db);
  const ps = [
    pac.salvar({ nome: 'Mariana Albuquerque Prado', cpf: '52998224725', email: 'mariana@exemplo.com', valor_padrao: '450' }),
    pac.salvar({ nome: 'Roberto Nogueira Lima', cpf: '11144477735', benef_nome: 'Lucas Nogueira Lima', benef_cpf: '39053344705', benef_nasc: '2012-05-14' }),
    pac.salvar({ nome: 'Helena Siqueira Campos', cpf: '84434891030', valor_padrao: '520' }),
    pac.salvar({ nome: 'Paulo Henrique Duarte', cpf: '15350946056' }),
  ];
  const emissor = new Emissor({
    db, config, certificado, pastaDocumentos: path.join(base, 'documentos', 'Notas do Consultório'),
    criarCliente: h.criarClienteFalso(['autoriza', 'autoriza', 'rejeita', 'timeout', 'autoriza'],
      { enviadas: [], consultas: [], cancelamentos: [], servidor: new Map() }),
    htmlParaPdf: async (html, destino) => fs.writeFileSync(destino, html),
  });
  const d = (n) => { const x = new Date(Date.now() - n * 86400000); return x.toISOString().slice(0, 10); };
  for (const [i, dia] of [[0, 6], [1, 5], [2, 3], [3, 2]]) {
    await emissor.emitir(emissor.criarRascunho({ paciente_id: ps[i].id, valor: ps[i].valor_padrao || 450, data_servico: d(dia) }).id);
  }
  await emissor.emitir(emissor.criarRascunho({ paciente_id: ps[0].id, valor: 450, data_servico: d(1) }).id);
  emissor.criarRascunho({ paciente_id: ps[2].id, valor: 520, data_servico: d(0) });
  emissor.criarRascunho({ paciente_id: ps[1].id, valor: 450, data_servico: d(0) });
  db.close();
}

const shots = process.env.NFSE_SHOTS;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let janela;
const carregou = new Promise((r) => app.on('browser-window-created', (_e, win) => {
  if (janela) return;
  janela = win;
  win.webContents.once('did-finish-load', () => r(win));
}));

async function fotografar() {
  fs.mkdirSync(shots, { recursive: true });
  const w = await carregou;
  w.setSize(1280, 860);
  await esperar(1500);
  const js = (code) => w.webContents.executeJavaScript(code);
  const foto = async (nome) => { await esperar(700); fs.writeFileSync(path.join(shots, nome + '.png'), (await w.webContents.capturePage()).toPNG()); };
  console.log('[demo] janela pronta');
  await foto('01-emitir');
  await js(`document.querySelector('#busca').value='Hel'; document.querySelector('#busca').dispatchEvent(new Event('input'));`);
  await foto('02-busca');
  await js(`document.querySelector('#sugestoes li[data-i="0"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
  await foto('03-escolhido');
  await js(`document.querySelector('#btn-emitir').click()`);
  await esperar(2500);
  await foto('04-emitida');
  for (const [v, nome] of [['notas', '05-notas'], ['pacientes', '06-pacientes'], ['relatorios', '07-relatorios'], ['config', '08-config'], ['ajuda', '09-ajuda']]) {
    await js(`document.querySelector('nav [data-view="${v}"]').click()`);
    await foto(nome);
  }
  await js(`document.querySelector('nav [data-view="pacientes"]').click()`);
  await esperar(500);
  await js(`document.querySelector('#btn-novo').click()`);
  await foto('10-novo-paciente');
  app.exit(0);
}

console.log('[demo] semeando em', base);
semear().catch((e) => { console.error(e); app.exit(1); }).then(() => {
  console.log('[demo] semeado');
  require('../src/main/index.js');
  if (shots) fotografar().catch((e) => { console.error(e); app.exit(1); });
});
