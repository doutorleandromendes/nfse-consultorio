'use strict';
// Núcleo fiscal: rascunho → reserva de número → envio → autorizada/rejeitada/incerta.
//
// Regra de ouro contra nota duplicada: o número da DPS é reservado e gravado ANTES do envio.
// Se a resposta não chegar (timeout, queda de internet, programa fechado no meio), a nota fica
// "incerta" e só pode ser reenviada depois de consultarmos a prefeitura pelo mesmo ID da DPS.
const fs = require('node:fs');
const path = require('node:path');
const lib = require('@4success/nfse-campinas');
const { onlyDigits, cpfValido, hojeISO, agoraComOffset, montarDiscriminacao } = require('./util');

const EDITAVEIS = ['rascunho', 'rejeitada'];

function erroAmigavel(e) {
  const msg = String((e && e.message) || e || '');
  const code = (e && (e.code || (e.cause && e.cause.code))) || '';
  if (/timeout|ECONNABORTED|ETIMEDOUT/i.test(code + msg)) {
    return 'A prefeitura não respondeu a tempo. A nota pode ou não ter sido registrada — use "Verificar" antes de tentar de novo.';
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|socket hang up/i.test(code + msg)) {
    return 'Sem conexão com o servidor da prefeitura (internet fora ou servidor indisponível). Use "Verificar" mais tarde.';
  }
  return msg;
}

function nomeArquivo(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

/** Monta o objeto DPS da biblioteca a partir da nota e das configurações. */
function montarDps(nota, cfg, { versao = '1.0.0' } = {}) {
  const municipio = cfg.municipio_ibge || '3509502';
  const tomador = {
    cpf: onlyDigits(nota.tomador_cpf),
    razaoSocial: nota.tomador_nome,
  };
  if (nota.tomador_email) tomador.email = nota.tomador_email;
  if (nota._endereco) tomador.endereco = nota._endereco;

  const tribMun = {
    tributacaoIssqn: Number(cfg.iss_tributacao || 1),
    tipoRetencaoIssqn: Number(cfg.iss_retencao || 1),
  };
  if (String(cfg.iss_aliquota || '').trim()) tribMun.aliquota = String(cfg.iss_aliquota).replace(',', '.').trim();

  const valores = {
    valorServico: Number(nota.valor).toFixed(2),
    tributacaoMunicipal: tribMun,
    totalTributos: { indicadorTotalTributos: 0 },
  };
  if (String(cfg.pis_cst || '').trim()) {
    valores.tributacaoFederal = { pisCofins: { cst: String(cfg.pis_cst).trim().padStart(2, '0'), tipoRetencaoPisCofins: 0 } };
  }

  const servico = {
    municipioPrestacao: municipio,
    codigoTributacaoNacional: onlyDigits(cfg.cod_trib_nacional),
    descricao: nota.discriminacao,
  };
  if (String(cfg.cod_trib_municipal || '').trim()) servico.codigoTributacaoMunicipal = String(cfg.cod_trib_municipal).trim();
  if (String(cfg.nbs || '').trim()) servico.codigoNbs = onlyDigits(cfg.nbs);

  const dps = {
    ambiente: nota.ambiente,
    idDps: nota.id_dps,
    serie: nota.serie,
    numeroDps: String(nota.n_dps),
    dataHoraEmissao: agoraComOffset(),
    dataCompetencia: nota.data_servico,
    versaoAplicativo: `NotasConsultorio-${versao}`.slice(0, 20),
    tipoEmitente: 1,
    municipioEmissao: municipio,
    prestador: {
      cnpj: onlyDigits(cfg.cnpj),
      inscricaoMunicipal: onlyDigits(cfg.inscricao_municipal) || String(cfg.inscricao_municipal || '').trim(),
      regimeTributario: {
        opcaoSimplesNacional: Number(cfg.opcao_simples),
        regimeEspecialTributacao: Number(cfg.regime_especial || 0),
      },
    },
    tomador,
    servico,
    valores,
  };
  if (String(cfg.ibs_incluir) !== '0') {
    dps.ibsCbs = {
      finalidadeNfse: 0,
      codigoIndicadorOperacao: onlyDigits(cfg.ibs_cind_op),
      indicadorDestinatario: 0,
      cst: onlyDigits(cfg.ibs_cst),
      classificacaoTributaria: onlyDigits(cfg.ibs_cclass),
    };
  }
  return dps;
}

class Emissor {
  /**
   * @param {object} o
   * @param {import('./db').Database} o.db
   * @param {import('./config').Config} o.config
   * @param {import('./cert').GerenciadorCertificado} o.certificado
   * @param {string} o.pastaDocumentos  onde ficam XML e PDF (subpastas por mês)
   * @param {(html:string, destino:string)=>Promise<void>} o.htmlParaPdf
   * @param {(opts:object)=>object} [o.criarCliente]  injeção para testes
   * @param {string} [o.versao]
   */
  constructor(o) {
    Object.assign(this, o);
    this.versao = o.versao || '1.0.0';
    this.criarCliente = o.criarCliente || ((opts) => new lib.NfseCampinas(opts));
  }

  // ── utilitários ─────────────────────────────────────────────────────
  cliente() {
    const { certificate, certPassword } = this.certificado.carregar();
    return this.criarCliente({
      environment: this.config.get('ambiente'),
      certificate,
      certPassword,
      timeoutMs: 120_000,
      applicationVersion: `NotasConsultorio-${this.versao}`.slice(0, 20),
    });
  }

  nota(id) {
    const n = this.db.get('SELECT * FROM notas WHERE id = ?', [id]);
    if (!n) throw new Error('Nota não encontrada.');
    n.mensagens = n.mensagens ? JSON.parse(n.mensagens) : [];
    return n;
  }

  atualizar(id, campos) {
    const ks = Object.keys(campos);
    const vals = ks.map((k) => (k === 'mensagens' && campos[k] != null ? JSON.stringify(campos[k]) : campos[k]));
    this.db.run(`UPDATE notas SET ${ks.map((k) => `${k} = ?`).join(', ')}, atualizado_em = datetime('now','localtime') WHERE id = ?`,
      [...vals, id]);
  }

  log(notaId, tipo, detalhe, request, response) {
    this.db.run('INSERT INTO eventos (nota_id, tipo, detalhe, request, response) VALUES (?,?,?,?,?)',
      [notaId ?? null, tipo, detalhe ?? null, request ?? null, response ?? null]);
  }

  // ── rascunhos ───────────────────────────────────────────────────────
  criarRascunho({ paciente_id, valor, data_servico, discriminacao }) {
    const p = this.db.get('SELECT * FROM pacientes WHERE id = ?', [paciente_id]);
    if (!p) throw new Error('Escolha um paciente.');
    const dados = this._validarDados({ valor, data_servico });
    const base = {
      tomador_nome: p.nome, tomador_cpf: onlyDigits(p.cpf), tomador_email: p.email || null,
      benef_nome: p.benef_nome || null, benef_cpf: p.benef_cpf ? onlyDigits(p.benef_cpf) : null,
      benef_nasc: p.benef_nasc || null, ...dados,
    };
    const texto = (discriminacao && discriminacao.trim()) ||
      montarDiscriminacao(this.config.get('discriminacao_modelo'), base);
    const id = this.db.run(
      `INSERT INTO notas (ambiente, paciente_id, tomador_nome, tomador_cpf, tomador_email, benef_nome, benef_cpf,
        benef_nasc, data_servico, valor, discriminacao, status) VALUES (?,?,?,?,?,?,?,?,?,?,?, 'rascunho')`,
      [this.config.get('ambiente'), p.id, base.tomador_nome, base.tomador_cpf, base.tomador_email, base.benef_nome,
        base.benef_cpf, base.benef_nasc, base.data_servico, base.valor, texto]);
    return this.nota(id);
  }

  /** Altera valor/data/texto de uma nota ainda não autorizada. */
  editarRascunho(id, { valor, data_servico, discriminacao }) {
    const n = this.nota(id);
    if (!EDITAVEIS.includes(n.status)) throw new Error('Só é possível alterar notas ainda não emitidas.');
    const dados = this._validarDados({ valor: valor ?? n.valor, data_servico: data_servico ?? n.data_servico });
    const texto = (discriminacao ?? n.discriminacao).trim();
    if (!texto) throw new Error('O texto da nota não pode ficar vazio.');
    this.atualizar(id, { ...dados, discriminacao: texto });
    return this.nota(id);
  }

  excluirRascunho(id) {
    const n = this.nota(id);
    if (!EDITAVEIS.includes(n.status)) throw new Error('Notas emitidas não podem ser apagadas — use "Cancelar nota".');
    this.db.run('DELETE FROM notas WHERE id = ?', [id]);
  }

  _validarDados({ valor, data_servico }) {
    let t = String(valor ?? '').replace(/[R$\s]/g, '');
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    const v = Number(t);
    if (!Number.isFinite(v) || v <= 0) throw new Error('Informe um valor maior que zero.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data_servico || ''))) throw new Error('Informe a data do atendimento.');
    if (data_servico > hojeISO()) throw new Error('A data do atendimento não pode ser no futuro.');
    return { valor: Math.round(v * 100) / 100, data_servico };
  }

  // ── emissão ─────────────────────────────────────────────────────────
  _verificarProntoParaEmitir() {
    const pend = this.config.pendencias();
    if (pend.length) throw new Error(pend.join('\n'));
    if (this.config.get('ambiente') === 'producao' && this.config.get('fiscal_conferido') !== '1') {
      throw new Error('Para emitir notas reais, marque em Configurações que a contadora conferiu os dados fiscais.');
    }
  }

  /** Reserva (ou reaproveita) o número da DPS e marca como "enviando", tudo numa transação. */
  _reservarNumero(id) {
    return this.db.tx(() => {
      const n = this.nota(id);
      if (!EDITAVEIS.includes(n.status)) throw new Error(`Esta nota está "${n.status}" e não pode ser enviada agora.`);
      const amb = this.config.get('ambiente');
      const serie = String(this.config.get('serie')).padStart(5, '0');
      let { n_dps: nDps, id_dps: idDps } = n;
      // Reaproveita o número só se ele foi reservado neste mesmo ambiente/série e a prefeitura não o registrou.
      if (!nDps || n.ambiente !== amb || n.serie !== serie) {
        const chaveProx = `proximo_ndps_${amb}`;
        nDps = Number(this.config.get(chaveProx)) || 1;
        // pula números que porventura já existam no banco
        while (this.db.get('SELECT 1 AS x FROM notas WHERE ambiente=? AND serie=? AND n_dps=?', [amb, serie, nDps])) nDps++;
        this.config.set(chaveProx, nDps + 1);
        idDps = lib.buildDpsId({
          codigoMunicipioEmissao: this.config.get('municipio_ibge') || '3509502',
          tipoInscricaoFederal: '2',
          inscricaoFederal: onlyDigits(this.config.get('cnpj')),
          serie,
          numeroDps: nDps,
        });
      }
      // Atualiza nome/CPF/e-mail com o cadastro atual (caso tenham sido corrigidos após uma rejeição).
      const p = n.paciente_id && this.db.get('SELECT * FROM pacientes WHERE id = ?', [n.paciente_id]);
      const tomador = p ? { tomador_nome: p.nome, tomador_cpf: onlyDigits(p.cpf), tomador_email: p.email || null } : {};
      this.atualizar(id, { ambiente: amb, serie, n_dps: nDps, id_dps: idDps, status: 'enviando', mensagens: [], ...tomador });
      return this.nota(id);
    });
  }

  _dadosEndereco(nota) {
    const p = nota.paciente_id && this.db.get('SELECT * FROM pacientes WHERE id = ?', [nota.paciente_id]);
    if (p && p.cep && p.logradouro && p.numero && p.bairro) {
      return {
        municipio: p.municipio_ibge || '3509502', cep: onlyDigits(p.cep), logradouro: p.logradouro,
        numero: p.numero, bairro: p.bairro, ...(p.complemento ? { complemento: p.complemento } : {}),
      };
    }
    return undefined;
  }

  /** Emite uma nota. Nunca lança por erro de rede: devolve a nota com status atualizado. */
  async emitir(id) {
    this._verificarProntoParaEmitir();
    const nota = this._reservarNumero(id);
    let cli;
    try {
      cli = this.cliente();
    } catch (e) {
      this.atualizar(id, { status: 'rejeitada', mensagens: [{ descricao: erroAmigavel(e) }] });
      return this.nota(id);
    }
    const dps = montarDps({ ...nota, _endereco: this._dadosEndereco(nota) }, this.config.all(), { versao: this.versao });

    let r;
    try {
      r = await cli.enviarDps(dps);
    } catch (e) {
      if (e instanceof lib.ValidationError || (e && e.name === 'ValidationError')) {
        const msgs = (e.issues || []).filter((i) => i.severity !== 'warning')
          .map((i) => ({ campo: i.field, descricao: i.message }));
        this.log(id, 'validacao', JSON.stringify(e.issues || e.message));
        this.atualizar(id, { status: 'rejeitada', mensagens: msgs.length ? msgs : [{ descricao: e.message }] });
        return this.nota(id);
      }
      this.log(id, 'envio_falha', String(e && e.stack || e));
      this.atualizar(id, { status: 'incerta', mensagens: [{ descricao: erroAmigavel(e) }] });
      return this.nota(id);
    }
    this.log(id, 'envio', `${r.status} HTTP ${r.httpStatus}`, r.rawRequest, r.rawResponse);

    if (r.status === 'autorizada') {
      return this._finalizarAutorizada(id, cli, r);
    }
    const http = Number(r.httpStatus) || 0;
    const rejeicaoClara = r.status === 'rejeitada' ||
      (r.status === 'erro_http' && http >= 400 && http < 500 && ![408, 429].includes(http) && r.mensagens.length);
    if (rejeicaoClara) {
      const duplicada = r.mensagens.some((m) => /j[aá] (existe|foi|cadastrad|emitid|registrad)|duplicid/i.test(m.descricao));
      if (duplicada) {
        // A prefeitura diz que essa DPS já existe → foi registrada num envio anterior. Busca a nota.
        this.atualizar(id, { status: 'incerta', mensagens: r.mensagens });
        return this.verificar(id);
      }
      this.atualizar(id, { status: 'rejeitada', mensagens: r.mensagens });
      return this.nota(id);
    }
    this.atualizar(id, {
      status: 'incerta',
      mensagens: r.mensagens.length ? r.mensagens : [{ descricao: `Resposta inesperada da prefeitura (HTTP ${http}). Use "Verificar".` }],
    });
    return this.nota(id);
  }

  async _finalizarAutorizada(id, cli, { chaveAcesso, numeroNfse, codigoVerificacao, nfseXmlGZipB64 }) {
    const n = this.nota(id);
    let xml = null;
    if (!nfseXmlGZipB64 && chaveAcesso) {
      try {
        const nf = await cli.consultarNfse(chaveAcesso);
        this.log(id, 'consulta_nfse', `HTTP ${nf.httpStatus}`, chaveAcesso, nf.rawResponse);
        nfseXmlGZipB64 = nf.nfseXmlGZipB64;
      } catch (e) {
        this.log(id, 'consulta_nfse_falha', String(e && e.stack || e));
      }
    }
    if (nfseXmlGZipB64) {
      xml = lib.decodeNfseXmlGZipB64(nfseXmlGZipB64);
      lib.assertNfseXmlMatchesDps(xml, n.id_dps);
    }
    const doXml = (tag) => (xml && (xml.match(new RegExp(`<(?:\\w+:)?${tag}>([^<]+)<`)) || [])[1]) || undefined;
    const numero = numeroNfse || doXml('nNFSe') || '';
    const chave = chaveAcesso || (xml && (xml.match(/Id="NFS(\d{50})"/) || [])[1]) || '';

    const mes = n.data_servico.slice(0, 7);
    const pasta = path.join(this.pastaDocumentos, n.ambiente === 'producao' ? '' : 'TESTE', mes);
    fs.mkdirSync(pasta, { recursive: true });
    const base = `NFSe ${numero || n.n_dps} - ${nomeArquivo(n.tomador_nome)}`;
    let xmlPath = null;
    if (xml) {
      xmlPath = path.join(pasta, base + '.xml');
      fs.writeFileSync(xmlPath, xml, 'utf8');
    }
    this.atualizar(id, {
      status: 'autorizada', chave_acesso: chave, numero_nfse: numero, codigo_verificacao: codigoVerificacao || doXml('cVerif') || null,
      xml_path: xmlPath, mensagens: [], emitida_em: new Date().toISOString(),
    });
    if (xml) await this.gerarPdf(id, cli).catch(() => {});
    return this.nota(id);
  }

  /** Gera (ou regenera) o PDF da DANFSe a partir do XML autorizado. */
  async gerarPdf(id, cli) {
    const n = this.nota(id);
    if (!n.xml_path || !fs.existsSync(n.xml_path)) throw new Error('XML da nota não encontrado.');
    try {
      const xml = fs.readFileSync(n.xml_path, 'utf8');
      const html = await (cli || this.cliente()).imprimirDanfse({ xml, descricaoServico: n.discriminacao });
      const pdfPath = n.xml_path.replace(/\.xml$/i, '.pdf');
      await this.htmlParaPdf(html, pdfPath);
      this.atualizar(id, { pdf_path: pdfPath });
      return pdfPath;
    } catch (e) {
      this.log(id, 'pdf_erro', String(e && e.stack || e));
      throw new Error('A nota foi emitida, mas não consegui gerar o PDF: ' + erroAmigavel(e));
    }
  }

  /**
   * Consulta a prefeitura pelo ID da DPS de uma nota "incerta"/"enviando".
   * - registrada  → busca o XML e marca como autorizada
   * - inexistente → volta para "rascunho" mantendo o MESMO número (seguro reenviar)
   * - sem resposta → continua "incerta"
   */
  async verificar(id) {
    const n = this.nota(id);
    if (!['incerta', 'enviando'].includes(n.status)) return n;
    let cli;
    try {
      cli = this.cliente();
    } catch (e) {
      this.atualizar(id, { mensagens: [{ descricao: erroAmigavel(e) }] });
      return this.nota(id);
    }
    try {
      const c = await cli.consultarDps(n.id_dps);
      this.log(id, 'consulta_dps', `HTTP ${c.httpStatus}`, n.id_dps, c.rawResponse);
      if (c.chaveAcesso) {
        const nf = await cli.consultarNfse(c.chaveAcesso);
        this.log(id, 'consulta_nfse', `HTTP ${nf.httpStatus}`, c.chaveAcesso, nf.rawResponse);
        if (!nf.nfseXmlGZipB64) throw new Error('A prefeitura informou a chave, mas não devolveu o XML. Tente "Verificar" de novo.');
        return this._finalizarAutorizada(id, cli, { chaveAcesso: c.chaveAcesso.replace(/^NFS/, ''), nfseXmlGZipB64: nf.nfseXmlGZipB64 });
      }
      return this._naoRegistrada(id);
    } catch (e) {
      const http = e && e.response && Number(e.response.httpStatus);
      const alertas = (e && e.response && e.response.alertas || []).map((a) => a.mensagem).join(' ');
      if (http === 404 || (http === 400 && /n[aã]o (encontrad|localizad|exist)|inexist/i.test(alertas))) {
        this.log(id, 'consulta_dps', `não encontrada (HTTP ${http})`, n.id_dps, e.response && e.response.rawResponse);
        return this._naoRegistrada(id);
      }
      this.log(id, 'consulta_falha', String(e && e.stack || e), n.id_dps, e && e.response && e.response.rawResponse);
      this.atualizar(id, { status: 'incerta', mensagens: [{ descricao: alertas || erroAmigavel(e) }] });
      return this.nota(id);
    }
  }

  _naoRegistrada(id) {
    this.atualizar(id, {
      status: 'rascunho',
      mensagens: [{ descricao: 'A prefeitura confirmou que esta nota não foi registrada. Pode emitir novamente com segurança.' }],
    });
    return this.nota(id);
  }

  /** "Tentar de novo": verifica primeiro; se não foi registrada, reenvia. */
  async tentarNovamente(id) {
    let n = this.nota(id);
    if (['incerta', 'enviando'].includes(n.status)) n = await this.verificar(id);
    if (EDITAVEIS.includes(n.status)) return this.emitir(id);
    return n;
  }

  async emitirLote(ids, aoProgredir = () => {}) {
    const resumo = { autorizadas: 0, rejeitadas: 0, incertas: 0, total: ids.length };
    for (let i = 0; i < ids.length; i++) {
      let n;
      try {
        n = await this.emitir(ids[i]);
      } catch (e) {
        n = { ...this.nota(ids[i]), erro: e.message };
        if (/Configurações|contadora/.test(e.message)) { // problema de configuração: não adianta continuar
          aoProgredir({ atual: i + 1, total: ids.length, nota: n });
          resumo.erroGeral = e.message;
          break;
        }
      }
      if (n.status === 'autorizada') resumo.autorizadas++;
      else if (n.status === 'incerta') resumo.incertas++;
      else resumo.rejeitadas++;
      aoProgredir({ atual: i + 1, total: ids.length, nota: n });
    }
    return resumo;
  }

  /** Ao abrir o programa: resolve o que ficou pendente da última vez. */
  async reconciliarPendentes() {
    const pend = this.db.all("SELECT id FROM notas WHERE status IN ('enviando','incerta')");
    const out = [];
    for (const { id } of pend) out.push(await this.verificar(id).catch(() => this.nota(id)));
    return out;
  }

  // ── cancelamento ────────────────────────────────────────────────────
  async cancelar(id, { codigoMotivo, motivo }) {
    const n = this.nota(id);
    if (n.status !== 'autorizada') throw new Error('Só notas emitidas podem ser canceladas.');
    const texto = String(motivo || '').trim();
    if (texto.length < 15) throw new Error('Descreva o motivo com pelo menos 15 letras (exigência da prefeitura).');
    if (![1, 2, 9].includes(Number(codigoMotivo))) throw new Error('Escolha o motivo do cancelamento.');
    const cli = this.cliente();
    let r;
    try {
      r = await cli.cancelarNfse({
        chaveAcesso: n.chave_acesso,
        autor: { cnpj: onlyDigits(this.config.get('cnpj')) },
        codigoMotivo: Number(codigoMotivo),
        motivo: texto.slice(0, 255),
      });
    } catch (e) {
      this.log(id, 'cancelamento_falha', String(e && e.stack || e), null, e && e.response && e.response.rawResponse);
      const alertas = (e && e.response && e.response.alertas || []).map((a) => [a.mensagem, a.complemento].filter(Boolean).join(' — '));
      throw new Error('A prefeitura não aceitou o cancelamento: ' + (alertas.join(' | ') || erroAmigavel(e)));
    }
    this.log(id, 'cancelamento', `HTTP ${r.httpStatus}`, r.rawRequest, r.rawResponse);
    if (!r.eventoXmlGZipB64 && r.alertas.length) {
      throw new Error('A prefeitura não aceitou o cancelamento: ' + r.alertas.map((a) => a.mensagem).join(' | '));
    }
    if (r.eventoXmlGZipB64 && n.xml_path) {
      fs.writeFileSync(n.xml_path.replace(/\.xml$/i, ' - CANCELAMENTO.xml'), lib.decodeNfseXmlGZipB64(r.eventoXmlGZipB64), 'utf8');
    }
    this.atualizar(id, { status: 'cancelada', cancelada_em: new Date().toISOString(), motivo_cancelamento: texto });
    return this.nota(id);
  }
}

module.exports = { Emissor, montarDps, erroAmigavel, cpfValido };
