'use strict';
// Única ponte entre a tela e o restante do programa.
const { contextBridge, ipcRenderer } = require('electron');

const chamar = async (canal, ...args) => {
  const r = await ipcRenderer.invoke(canal, ...args);
  if (!r.ok) throw new Error(r.erro);
  return r.dados;
};

const canais = [
  'estado',
  'config:campos', 'config:salvar', 'config:instalarCertificado', 'config:trocarAmbiente',
  'pacientes:listar', 'pacientes:obter', 'pacientes:salvar', 'pacientes:importar',
  'notas:listar', 'notas:obter', 'notas:ultimaDoPaciente', 'notas:rascunho', 'notas:editar', 'notas:excluir', 'notas:emitir',
  'notas:verificar', 'notas:tentarNovamente', 'notas:cancelar', 'notas:gerarPdf', 'notas:lote',
  'notas:abrirPdf', 'notas:mostrarNaPasta',
  'relatorios:mensal', 'relatorios:dmed',
  'manut:escolherPastaBackup', 'manut:backupAgora', 'manut:restaurar', 'manut:diagnostico',
  'manut:abrirDocumentos', 'manut:instalarAtualizacao',
];

const api = {};
for (const c of canais) api[c] = (...args) => chamar(c, ...args);
api.on = (evento, fn) => {
  if (!['lote:progresso', 'atualizacao', 'reconciliado'].includes(evento)) return;
  ipcRenderer.on(evento, (_e, dados) => fn(dados));
};

contextBridge.exposeInMainWorld('api', api);
