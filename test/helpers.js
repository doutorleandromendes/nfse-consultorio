'use strict';
// Utilitários de teste: certificado e-CNPJ falso (autoassinado) e um cliente da prefeitura simulado.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const forge = require('node-forge');
const lib = require('@4success/nfse-campinas');
const { Database } = require('../src/main/db');
const { Config } = require('../src/main/config');
const { GerenciadorCertificado } = require('../src/main/cert');
const { Emissor } = require('../src/main/emissor');
const { Pacientes } = require('../src/main/pacientes');
const { Relatorios } = require('../src/main/relatorios');

const CNPJ = '11222333000181';

function criarPfx({ cnpj = CNPJ, senha = 'segredo', dias = 365 } = {}) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + dias * 86_400_000);
  const attrs = [{ name: 'commonName', value: `CLINICA TESTE LTDA:${cnpj}` }, { name: 'countryName', value: 'BR' }];
  cert.setSubject(attrs);
  cert.setIssuer([{ name: 'commonName', value: 'AC TESTE' }]);
  const asn1 = forge.asn1;
  const otherName = (oid, valor) => asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oid).getBytes()),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, valor),
    ]),
  ]);
  const san = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    otherName('2.16.76.1.3.4', '01011980123456789010000000000000000000000000000'), // dados do responsável
    otherName('2.16.76.1.3.3', cnpj),
  ]);
  cert.setExtensions([{ name: 'basicConstraints', cA: false }, { id: '2.5.29.17', value: asn1.toDer(san).getBytes() }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, { algorithm: '3des' });
  return Buffer.from(asn1.toDer(p12).getBytes(), 'binary');
}

const cofreTeste = {
  cifrar: (s) => 'b64:' + Buffer.from(s).toString('base64'),
  decifrar: (v) => Buffer.from(v.slice(4), 'base64').toString(),
};

/** Monta um XML de NFS-e "autorizada" contendo a DPS assinada enviada. */
function nfseFalsa(signedXml, numero) {
  const dps = signedXml.replace(/^<\?xml[^>]*>\s*/, '');
  const chave = '3509502' + '2' + CNPJ + String(numero).padStart(13, '0') + '2610' + '123456789';
  const ch50 = (chave + '0'.repeat(50)).slice(0, 50);
  const xml = `<?xml version="1.0" encoding="UTF-8"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">` +
    `<infNFSe Id="NFS${ch50}"><nNFSe>${numero}</nNFSe><cVerif>ABC123</cVerif>${dps}</infNFSe></NFSe>`;
  return { chave: ch50, gz: zlib.gzipSync(Buffer.from(xml)).toString('base64') };
}

/**
 * Cliente simulado. `roteiro` é uma lista de comportamentos consumidos a cada envio:
 * 'autoriza' | 'rejeita' | 'timeout' | 'timeout-mas-registrou' | 'http500' | 'duplicada'
 */
function criarClienteFalso(roteiro, registro) {
  return (opts) => {
    const real = new lib.NfseCampinas(opts);
    return {
      async enviarDps(dps) {
        const comportamento = roteiro.shift() || 'autoriza';
        const xml = real.buildDpsXml(dps);
        const signedXml = await real.signDpsXml(xml);
        registro.enviadas.push({ dps, signedXml, comportamento });
        const base = { idDps: dps.idDps, signedXml, rawRequest: signedXml, headers: {}, parsedResponse: {} };
        if (comportamento === 'timeout' || comportamento === 'timeout-mas-registrou') {
          if (comportamento === 'timeout-mas-registrou') {
            registro.servidor.set(dps.idDps, nfseFalsa(signedXml, 900 + registro.enviadas.length));
          }
          const e = new Error('timeout of 120000ms exceeded');
          e.code = 'ECONNABORTED';
          throw e;
        }
        if (comportamento === 'rejeita') {
          return { ...base, status: 'erro_http', httpStatus: 400, rawResponse: '{"erros":[]}',
            mensagens: [{ codigo: 'E0312', descricao: 'CPF do tomador inválido' }] };
        }
        if (comportamento === 'http500') {
          return { ...base, status: 'erro_http', httpStatus: 500, rawResponse: 'Internal error', mensagens: [] };
        }
        if (comportamento === 'duplicada') {
          registro.servidor.set(dps.idDps, nfseFalsa(signedXml, 777));
          return { ...base, status: 'erro_http', httpStatus: 400, rawResponse: '{}',
            mensagens: [{ codigo: 'E0014', descricao: 'Conjunto de Série e Número já existe para o emitente' }] };
        }
        const nf = nfseFalsa(signedXml, 100 + registro.enviadas.length);
        registro.servidor.set(dps.idDps, nf);
        return { ...base, status: 'autorizada', httpStatus: 201, rawResponse: '{}', mensagens: [],
          chaveAcesso: nf.chave, numeroNfse: String(100 + registro.enviadas.length), nfseXmlGZipB64: nf.gz };
      },
      async consultarDps(idDps) {
        registro.consultas.push(idDps);
        const nf = registro.servidor.get(idDps);
        if (!nf) {
          const e = new lib.ConsultaDpsHttpError('HTTP 404', idDps, 'req',
            { idDps, alertas: [{ mensagem: 'DPS não encontrada' }], httpStatus: 404, rawResponse: '{}', headers: {}, parsedResponse: {} });
          throw e;
        }
        return { idDps, chaveAcesso: nf.chave, alertas: [], httpStatus: 200, rawResponse: '{}', headers: {}, parsedResponse: {} };
      },
      async consultarNfse(chave) {
        const ch = chave.replace(/^NFS/, '');
        const nf = [...registro.servidor.values()].find((v) => v.chave === ch);
        return { chaveAcesso: ch, nfseXmlGZipB64: nf && nf.gz, alertas: [], httpStatus: 200, rawResponse: '{}', headers: {} };
      },
      async cancelarNfse(input) {
        registro.cancelamentos.push(input);
        const xml = real.buildCancelamentoNfseXml(input); // valida a entrada de verdade
        return { chaveAcesso: input.chaveAcesso, alertas: [], httpStatus: 201, rawResponse: '{}', headers: {},
          signedXml: xml, rawRequest: xml, eventoXmlGZipB64: zlib.gzipSync(Buffer.from('<evento/>')).toString('base64') };
      },
      imprimirDanfse: (input) => real.imprimirDanfse(input),
    };
  };
}

async function montarAmbiente({ roteiro = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-teste-'));
  const db = await Database.open(path.join(dir, 'notas.db'));
  const config = new Config(db);
  config.setMany({
    razao_social: 'CLINICA TESTE LTDA', cnpj: CNPJ, inscricao_municipal: '123456', opcao_simples: '3', valor_padrao: '400',
  });
  const certificado = new GerenciadorCertificado({ config, caminhoPfx: path.join(dir, 'cert.pfx'), cofre: cofreTeste });
  const pfx = path.join(dir, 'origem.pfx');
  fs.writeFileSync(pfx, criarPfx());
  certificado.instalar(pfx, 'segredo');
  const registro = { enviadas: [], consultas: [], cancelamentos: [], servidor: new Map(), pdfs: [] };
  const emissor = new Emissor({
    db, config, certificado, pastaDocumentos: path.join(dir, 'docs'), versao: '1.0.0',
    criarCliente: criarClienteFalso(roteiro, registro),
    htmlParaPdf: async (html, destino) => { fs.writeFileSync(destino, html); registro.pdfs.push(destino); },
  });
  const pacientes = new Pacientes(db);
  const relatorios = new Relatorios(db, config);
  return { dir, db, config, certificado, emissor, pacientes, relatorios, registro, roteiro };
}

module.exports = { criarPfx, montarAmbiente, criarClienteFalso, CNPJ, cofreTeste };
