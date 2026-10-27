'use strict';
// Certificado digital e-CNPJ A1 (.pfx/.p12).
// O arquivo é copiado para a pasta de dados do programa; a senha é cifrada pelo
// sistema operacional (Windows DPAPI / macOS Keychain) via safeStorage do Electron.
const fs = require('node:fs');
const forge = require('node-forge');
const { PfxCertificate } = require('@4success/nfse-campinas');
const { onlyDigits } = require('./util');

const OID_CNPJ = '2.16.76.1.3.3';

/** Procura o CNPJ do titular (ICP-Brasil: otherName 2.16.76.1.3.3 no subjectAltName, ou no CN). */
function extrairCnpj(cert) {
  try {
    const ext = cert.extensions.find((e) => e.name === 'subjectAltName');
    if (ext) {
      const asn = forge.asn1.fromDer(ext.value);
      for (const gn of asn.value) {
        // otherName: [0] { OID, [0] EXPLICIT valor }
        if (gn.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || gn.type !== 0) continue;
        const [oidNode, valNode] = gn.value;
        if (!oidNode || forge.asn1.derToOid(oidNode.value) !== OID_CNPJ) continue;
        const inner = valNode && valNode.value && valNode.value[0];
        const raw = inner && typeof inner.value === 'string' ? inner.value : '';
        const d = onlyDigits(raw);
        if (d.length >= 14) return d.slice(0, 14);
      }
    }
  } catch (_) { /* segue para o CN */ }
  const cn = (cert.subject.getField('CN') || {}).value || '';
  const m = cn.match(/(\d{14})\s*$/) || cn.match(/:(\d{14})/);
  return m ? m[1] : '';
}

/**
 * Valida o .pfx com a senha e devolve as informações relevantes.
 * Lança erro com mensagem amigável se a senha estiver errada ou o arquivo for inválido.
 */
function lerCertificado(pfxBuffer, senha) {
  let pem;
  try {
    pem = new PfxCertificate(pfxBuffer, senha).toPem();
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/password|mac|integrity|senha/i.test(msg)) throw new Error('Senha do certificado incorreta.');
    throw new Error('Não foi possível abrir o certificado. Verifique se é um arquivo .pfx ou .p12 válido. (' + msg + ')');
  }
  const primeiroPem = pem.publicCert.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)[0];
  const cert = forge.pki.certificateFromPem(primeiroPem);
  const cn = (cert.subject.getField('CN') || {}).value || '';
  return {
    titular: cn.replace(/:\d{11,14}\s*$/, ''),
    cnpj: extrairCnpj(cert),
    validoDe: cert.validity.notBefore.toISOString(),
    validoAte: cert.validity.notAfter.toISOString(),
    emissor: (cert.issuer.getField('CN') || {}).value || '',
  };
}

function diasParaVencer(info, agora = new Date()) {
  if (!info || !info.validoAte) return null;
  return Math.floor((new Date(info.validoAte) - agora) / 86_400_000);
}

class GerenciadorCertificado {
  /**
   * @param {object} opts
   * @param {import('./config').Config} opts.config
   * @param {string} opts.caminhoPfx  onde o .pfx fica guardado
   * @param {{cifrar:(s:string)=>string, decifrar:(s:string)=>string}} opts.cofre
   */
  constructor({ config, caminhoPfx, cofre }) {
    this.config = config;
    this.caminhoPfx = caminhoPfx;
    this.cofre = cofre;
  }

  instalar(arquivoOrigem, senha) {
    const buf = fs.readFileSync(arquivoOrigem);
    const info = lerCertificado(buf, senha);
    if (new Date(info.validoAte) < new Date()) {
      throw new Error(`Este certificado venceu em ${new Date(info.validoAte).toLocaleDateString('pt-BR')}.`);
    }
    const cnpjCfg = onlyDigits(this.config.get('cnpj'));
    if (cnpjCfg && info.cnpj && cnpjCfg !== info.cnpj) {
      throw new Error(`O certificado é do CNPJ ${info.cnpj}, mas o CNPJ configurado é ${cnpjCfg}. ` +
        'Confira se escolheu o certificado da empresa certa.');
    }
    fs.writeFileSync(this.caminhoPfx, buf, { mode: 0o600 });
    this.config.setMany({
      cert_senha: this.cofre.cifrar(senha),
      cert_info: JSON.stringify(info),
      ...(cnpjCfg || !info.cnpj ? {} : { cnpj: info.cnpj }),
    });
    return info;
  }

  info() {
    const raw = this.config.get('cert_info');
    if (!raw) return null;
    const info = JSON.parse(raw);
    return { ...info, diasParaVencer: diasParaVencer(info) };
  }

  /** Buffer + senha para a biblioteca de NFS-e. */
  carregar() {
    if (!fs.existsSync(this.caminhoPfx) || !this.config.get('cert_senha')) {
      throw new Error('Nenhum certificado instalado. Vá em Configurações → Certificado digital.');
    }
    return { certificate: fs.readFileSync(this.caminhoPfx), certPassword: this.cofre.decifrar(this.config.get('cert_senha')) };
  }
}

module.exports = { GerenciadorCertificado, lerCertificado, diasParaVencer, extrairCnpj };
