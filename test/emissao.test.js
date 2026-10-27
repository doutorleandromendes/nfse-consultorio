'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { montarAmbiente, criarPfx, CNPJ } = require('./helpers');
const util = require('../src/main/util');
const manut = require('../src/main/manutencao');
const { Database } = require('../src/main/db');

const CPF_A = '52998224725';
const CPF_B = '11144477735';
const CPF_C = '39053344705';
const ONTEM = util.hojeISO(new Date(Date.now() - 86_400_000));

async function comPaciente(amb, extra = {}) {
  return amb.pacientes.salvar({ nome: 'Maria da Silva', cpf: CPF_A, email: 'maria@exemplo.com', valor_padrao: '450,00', ...extra });
}

test('validadores e texto da nota', () => {
  assert.ok(util.cpfValido('529.982.247-25'));
  assert.ok(!util.cpfValido('529.982.247-26'));
  assert.ok(!util.cpfValido('111.111.111-11'));
  assert.ok(util.cnpjValido(CNPJ));
  const t = util.montarDiscriminacao('Consulta médica realizada em {data}. {beneficiario}', {
    data_servico: '2026-10-20', tomador_nome: 'João', benef_nome: 'Pedro', benef_cpf: CPF_B,
  });
  assert.equal(t, 'Consulta médica realizada em 20/10/2026. Paciente: Pedro (CPF 111.444.777-35).');
  const sem = util.montarDiscriminacao('Consulta médica realizada em {data}. {beneficiario}', { data_servico: '2026-10-20' });
  assert.equal(sem, 'Consulta médica realizada em 20/10/2026.');
  assert.match(util.agoraComOffset(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  const m = util.mascararDocumentos('cpf 529.982.247-25 e 52998224725 <xNome>Maria</xNome> maria@x.com');
  assert.ok(!m.includes('52998224725') && !m.includes('529.982') && !m.includes('Maria') && !m.includes('maria@'));
});

test('certificado: lê CNPJ do e-CNPJ, recusa senha errada, CNPJ diferente e vencido', async () => {
  const amb = await montarAmbiente();
  const info = amb.certificado.info();
  assert.equal(info.cnpj, CNPJ);
  assert.equal(info.titular, 'CLINICA TESTE LTDA');
  assert.ok(info.diasParaVencer >= 364);
  const f = path.join(amb.dir, 'outro.pfx');
  fs.writeFileSync(f, criarPfx());
  assert.throws(() => amb.certificado.instalar(f, 'errada'), /Senha do certificado incorreta/);
  fs.writeFileSync(f, criarPfx({ cnpj: '11444777000161' }));
  assert.throws(() => amb.certificado.instalar(f, 'segredo'), /CNPJ/);
  fs.writeFileSync(f, criarPfx({ dias: -2 }));
  assert.throws(() => amb.certificado.instalar(f, 'segredo'), /venceu/);
});

test('pacientes: valida CPF, impede duplicado, importa CSV', async () => {
  const amb = await montarAmbiente();
  assert.throws(() => amb.pacientes.salvar({ nome: 'Fulano', cpf: '123' }), /CPF inválido/);
  const p = await comPaciente(amb);
  assert.equal(p.valor_padrao, 450);
  assert.throws(() => amb.pacientes.salvar({ nome: 'Outra', cpf: CPF_A }), /Já existe/);
  const r = amb.pacientes.importarCsv(`nome;cpf;email;valor\nJoão Souza;${CPF_B};joao@x.com;350\nRuim;000;;\nRepetida;${CPF_A};;`);
  assert.equal(r.importados, 1);
  assert.equal(r.ignorados.length, 2);
  assert.equal(amb.pacientes.listar({ busca: 'joão' }).length, 1);
  assert.equal(amb.pacientes.listar({ busca: '111.444' }).length, 1);
});

test('emissão autorizada: numera, assina, guarda XML e PDF, incrementa', async () => {
  const amb = await montarAmbiente();
  const p = await comPaciente(amb);
  const r = amb.emissor.criarRascunho({ paciente_id: p.id, valor: '450,00', data_servico: ONTEM });
  const n = await amb.emissor.emitir(r.id);
  assert.equal(n.status, 'autorizada', JSON.stringify(n.mensagens));
  assert.equal(n.n_dps, 1);
  assert.match(n.id_dps, /^DPS3509502211222333000181000010{0,15}1$/);
  assert.ok(n.numero_nfse && n.chave_acesso.length === 50);
  assert.ok(fs.existsSync(n.xml_path) && fs.existsSync(n.pdf_path));
  assert.ok(n.xml_path.includes(path.join('TESTE', ONTEM.slice(0, 7))));
  const env = amb.registro.enviadas[0];
  assert.match(env.signedXml, /<Signature/);
  assert.match(env.signedXml, new RegExp(`<CPF>${CPF_A}</CPF>`));
  assert.match(env.signedXml, /<vServ>450.00<\/vServ>/);
  assert.match(env.signedXml, new RegExp(`<dCompet>${ONTEM}</dCompet>`));
  assert.match(env.signedXml, /<tpAmb>2<\/tpAmb>/);
  assert.match(env.signedXml, /<cTribNac>040101<\/cTribNac>/);
  const pdfHtml = fs.readFileSync(n.pdf_path, 'utf8');
  assert.match(pdfHtml, /<html/i);

  const r2 = amb.emissor.criarRascunho({ paciente_id: p.id, valor: 450, data_servico: ONTEM });
  const n2 = await amb.emissor.emitir(r2.id);
  assert.equal(n2.n_dps, 2);
  assert.equal(amb.config.get('proximo_ndps_homologacao'), '3');
});

test('rejeitada: corrige e reenvia reaproveitando o mesmo número', async () => {
  const amb = await montarAmbiente({ roteiro: ['rejeita', 'autoriza'] });
  const p = await comPaciente(amb);
  const r = amb.emissor.criarRascunho({ paciente_id: p.id, valor: 450, data_servico: ONTEM });
  const n = await amb.emissor.emitir(r.id);
  assert.equal(n.status, 'rejeitada');
  assert.match(n.mensagens[0].descricao, /CPF do tomador/);
  amb.pacientes.salvar({ id: p.id, nome: 'Maria da Silva Corrigida' });
  amb.emissor.editarRascunho(r.id, { valor: '500' });
  const n2 = await amb.emissor.emitir(r.id);
  assert.equal(n2.status, 'autorizada');
  assert.equal(n2.n_dps, 1);
  assert.equal(n2.valor, 500);
  assert.equal(n2.tomador_nome, 'Maria da Silva Corrigida');
});

test('timeout sem registro: fica "incerta", consulta antes de reenviar, mesmo número, sem duplicar', async () => {
  const amb = await montarAmbiente({ roteiro: ['timeout', 'autoriza'] });
  const p = await comPaciente(amb);
  const r = amb.emissor.criarRascunho({ paciente_id: p.id, valor: 450, data_servico: ONTEM });
  const n = await amb.emissor.emitir(r.id);
  assert.equal(n.status, 'incerta');
  assert.match(n.mensagens[0].descricao, /não respondeu a tempo/);
  await assert.rejects(() => amb.emissor.emitir(r.id), /incerta/); // não deixa reenviar às cegas
  const n2 = await amb.emissor.tentarNovamente(r.id);
  assert.equal(amb.registro.consultas.length, 1, 'consultou a prefeitura antes');
  assert.equal(n2.status, 'autorizada');
  assert.equal(n2.n_dps, 1);
  assert.equal(amb.registro.enviadas[0].dps.idDps, amb.registro.enviadas[1].dps.idDps);
});

test('timeout mas a prefeitura registrou: recupera a nota sem reenviar', async () => {
  const amb = await montarAmbiente({ roteiro: ['timeout-mas-registrou'] });
  const p = await comPaciente(amb);
  const r = amb.emissor.criarRascunho({ paciente_id: p.id, valor: 450, data_servico: ONTEM });
  assert.equal((await amb.emissor.emitir(r.id)).status, 'incerta');
  const n = await amb.emissor.tentarNovamente(r.id);
  assert.equal(n.status, 'autorizada');
  assert.equal(amb.registro.enviadas.length, 1, 'não reenviou');
  assert.ok(fs.existsSync(n.xml_path));
});

test('reconciliação ao abrir o programa e resposta "já existe"', async () => {
  const amb = await montarAmbiente({ roteiro: ['timeout-mas-registrou', 'duplicada', 'http500'] });
  const p = await comPaciente(amb);
  const a = amb.emissor.criarRascunho({ paciente_id: p.id, valor: 450, data_servico: ONTEM });
  const b = amb.emissor.criarRascunho({ paciente_id: p.id, valor: 450, data_servico: ONTEM });
  const c = amb.emissor.criarRascunho({ paciente_id: p.id, valor: 450, data_servico: ONTEM });
  await amb.emissor.emitir(a.id);
  assert.equal((await amb.emissor.emitir(b.id)).status, 'autorizada', 'duplicada → busca a existente');
  assert.equal((await amb.emissor.emitir(c.id)).status, 'incerta', 'erro 500 → incerta');
  const rec = await amb.emissor.reconciliarPendentes();
  assert.equal(rec.length, 2);
  assert.equal(amb.emissor.nota(a.id).status, 'autorizada');
  assert.equal(amb.emissor.nota(c.id).status, 'rascunho', 'não registrada → liberada para reenviar');
  assert.equal(amb.emissor.nota(c.id).n_dps, 3, 'mantém o número reservado');
});

test('lote: emite vários e informa progresso', async () => {
  const amb = await montarAmbiente({ roteiro: ['autoriza', 'rejeita', 'autoriza'] });
  const p = await comPaciente(amb);
  const ids = [1, 2, 3].map(() => amb.emissor.criarRascunho({ paciente_id: p.id, valor: 450, data_servico: ONTEM }).id);
  const prog = [];
  const res = await amb.emissor.emitirLote(ids, (x) => prog.push(x.atual));
  assert.deepEqual(prog, [1, 2, 3]);
  assert.equal(res.autorizadas, 2);
  assert.equal(res.rejeitadas, 1);
});

test('proteções: data futura, valor zero, produção sem conferência da contadora', async () => {
  const amb = await montarAmbiente();
  const p = await comPaciente(amb);
  assert.throws(() => amb.emissor.criarRascunho({ paciente_id: p.id, valor: 450, data_servico: '2999-01-01' }), /futuro/);
  assert.throws(() => amb.emissor.criarRascunho({ paciente_id: p.id, valor: '0', data_servico: ONTEM }), /maior que zero/);
  const r = amb.emissor.criarRascunho({ paciente_id: p.id, valor: '1.234,56', data_servico: ONTEM });
  assert.equal(r.valor, 1234.56);
  amb.config.set('ambiente', 'producao');
  await assert.rejects(() => amb.emissor.emitir(r.id), /contadora/);
  amb.config.set('fiscal_conferido', '1');
  const n = await amb.emissor.emitir(r.id);
  assert.equal(n.status, 'autorizada');
  assert.equal(n.ambiente, 'producao');
  assert.equal(n.n_dps, 1, 'numeração de produção é separada da de teste');
  assert.match(amb.registro.enviadas[0].signedXml, /<tpAmb>1<\/tpAmb>/);
});

test('cancelamento', async () => {
  const amb = await montarAmbiente();
  const p = await comPaciente(amb);
  const r = amb.emissor.criarRascunho({ paciente_id: p.id, valor: 450, data_servico: ONTEM });
  const n = await amb.emissor.emitir(r.id);
  await assert.rejects(() => amb.emissor.cancelar(n.id, { codigoMotivo: 1, motivo: 'curto' }), /15 letras/);
  const c = await amb.emissor.cancelar(n.id, { codigoMotivo: 1, motivo: 'Valor digitado errado na emissão' });
  assert.equal(c.status, 'cancelada');
  assert.equal(amb.registro.cancelamentos[0].autor.cnpj, CNPJ);
  assert.ok(fs.existsSync(n.xml_path.replace(/\.xml$/, ' - CANCELAMENTO.xml')));
  assert.throws(() => amb.emissor.excluirRascunho(n.id), /não podem ser apagadas/);
});

test('relatórios: pacote da contadora e base da DMED', async () => {
  const amb = await montarAmbiente();
  amb.config.setMany({ ambiente: 'producao', fiscal_conferido: '1' });
  const pai = amb.pacientes.salvar({ nome: 'José Pai', cpf: CPF_B, benef_nome: 'Ana Filha', benef_cpf: CPF_C, benef_nasc: '2015-03-02' });
  const p = await comPaciente(amb);
  for (const pid of [pai.id, pai.id, p.id]) {
    await amb.emissor.emitir(amb.emissor.criarRascunho({ paciente_id: pid, valor: 300, data_servico: ONTEM }).id);
  }
  const notaPai = amb.emissor.nota(1);
  assert.match(notaPai.discriminacao, /Paciente: Ana Filha/);
  const [ano, mes] = ONTEM.split('-').map(Number);
  const zipPath = path.join(amb.dir, 'pacote.zip');
  const res = amb.relatorios.pacoteMensal(ano, mes, zipPath);
  assert.equal(res.notas, 3);
  const nomes = new AdmZip(zipPath).getEntries().map((e) => e.entryName);
  assert.equal(nomes.filter((n) => n.startsWith('XML/')).length, 3);
  assert.equal(nomes.filter((n) => n.startsWith('PDF/')).length, 3);
  const csvPath = path.join(amb.dir, 'dmed.csv');
  const d = amb.relatorios.dmed(ano, csvPath);
  assert.equal(d.linhas, 2);
  const csv = fs.readFileSync(csvPath, 'utf8');
  assert.match(csv, /111\.444\.777-35;José Pai;390\.533\.447-05;Ana Filha;02\/03\/2015;600,00;2/);
});

test('backup, restauração em outro computador e diagnóstico mascarado', async () => {
  const amb = await montarAmbiente();
  const p = await comPaciente(amb);
  const n = await amb.emissor.emitir(amb.emissor.criarRascunho({ paciente_id: p.id, valor: 450, data_servico: ONTEM }).id);
  const destino = path.join(amb.dir, 'backups');
  const zip = manut.fazerBackup({ arquivoDb: amb.db.file, pastaDocumentos: path.join(amb.dir, 'docs'), pastaDestino: destino });
  assert.ok(fs.existsSync(zip));

  // "outro computador"
  const outro = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'nfse-outro-'));
  const dbOutro = path.join(outro, 'notas.db');
  const docsOutro = path.join(outro, 'docs');
  manut.restaurarBackup({ arquivoZip: zip, arquivoDb: dbOutro, pastaDocumentos: docsOutro });
  const db2 = await Database.open(dbOutro);
  manut.corrigirCaminhos(db2, docsOutro);
  const n2 = db2.get('SELECT * FROM notas WHERE id = ?', [n.id]);
  assert.ok(n2.xml_path.startsWith(docsOutro) && fs.existsSync(n2.xml_path) && fs.existsSync(n2.pdf_path));

  const diag = path.join(amb.dir, 'diag.zip');
  manut.gerarDiagnostico({ db: amb.db, config: amb.config, versao: '1.0.0', destino: diag, pendencias: [], certInfo: null });
  const z = new AdmZip(diag);
  const tudo = z.getEntries().map((e) => e.getData().toString('utf8')).join('\n');
  assert.ok(!tudo.includes(CPF_A), 'CPF do paciente não pode aparecer');
  assert.ok(!tudo.includes('Maria da Silva'), 'nome do paciente não pode aparecer');
  assert.ok(!tudo.includes('cert_senha'), 'senha não pode aparecer');
});
