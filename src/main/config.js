'use strict';
// Definição de todas as configurações. A tela de Configurações é montada a partir daqui,
// então para acrescentar um campo basta incluí-lo nesta lista.

const CAMPOS = [
  // ── Dados da empresa ───────────────────────────────────────────────
  { chave: 'razao_social', grupo: 'empresa', rotulo: 'Razão social', tipo: 'text', obrigatorio: true,
    ajuda: 'Exatamente como está no cartão CNPJ.' },
  { chave: 'cnpj', grupo: 'empresa', rotulo: 'CNPJ', tipo: 'cnpj', obrigatorio: true,
    ajuda: 'Precisa ser o mesmo CNPJ do certificado digital.' },
  { chave: 'inscricao_municipal', grupo: 'empresa', rotulo: 'Inscrição municipal (CCM)', tipo: 'text', obrigatorio: true,
    ajuda: 'Número de inscrição da empresa na Prefeitura de Campinas.' },
  { chave: 'municipio_ibge', grupo: 'empresa', rotulo: 'Código IBGE do município', tipo: 'text', obrigatorio: true,
    padrao: '3509502', avancado: true, ajuda: 'Campinas = 3509502. Não altere.' },

  // ── Dados fiscais (preencher com a contadora) ─────────────────────
  { chave: 'opcao_simples', grupo: 'fiscal', rotulo: 'Situação no Simples Nacional', tipo: 'select', obrigatorio: true,
    opcoes: [['1', 'Não optante (Lucro Presumido / Real)'], ['3', 'Optante — ME/EPP'], ['2', 'MEI']],
    ajuda: 'Pergunte à contadora qual é o regime tributário da empresa.' },
  { chave: 'regime_especial', grupo: 'fiscal', rotulo: 'Regime especial de tributação', tipo: 'select', obrigatorio: true,
    padrao: '0',
    opcoes: [['0', 'Nenhum'], ['6', 'Sociedade de profissionais'], ['5', 'Profissional autônomo'],
      ['3', 'Microempresa municipal'], ['1', 'Ato cooperado'], ['2', 'Estimativa'], ['9', 'Outros']],
    ajuda: 'Na maioria dos consultórios é "Nenhum". A contadora confirma.' },
  { chave: 'cod_trib_nacional', grupo: 'fiscal', rotulo: 'Código de tributação nacional', tipo: 'text', obrigatorio: true,
    padrao: '040101', ajuda: 'Seis dígitos. Sugestão: 040101 (Medicina). Confirme com a contadora.' },
  { chave: 'cod_trib_municipal', grupo: 'fiscal', rotulo: 'Código de tributação municipal', tipo: 'text',
    ajuda: 'Opcional. Preencha somente se a contadora indicar.' },
  { chave: 'nbs', grupo: 'fiscal', rotulo: 'Código NBS', tipo: 'text',
    ajuda: 'Opcional em muitos casos. Preencha somente se a contadora indicar.' },
  { chave: 'iss_aliquota', grupo: 'fiscal', rotulo: 'Alíquota do ISS (%)', tipo: 'text',
    ajuda: 'Ex.: 2 ou 5. Para optantes do Simples a contadora pode orientar deixar em branco.' },
  { chave: 'iss_tributacao', grupo: 'fiscal', rotulo: 'Tributação do ISS', tipo: 'select', obrigatorio: true, padrao: '1',
    opcoes: [['1', 'Tributável'], ['2', 'Imunidade'], ['4', 'Não incidência']], avancado: true },
  { chave: 'iss_retencao', grupo: 'fiscal', rotulo: 'Retenção do ISS', tipo: 'select', obrigatorio: true, padrao: '1',
    opcoes: [['1', 'Não retido'], ['2', 'Retido pelo tomador']], avancado: true,
    ajuda: 'Pacientes pessoa física não retêm ISS.' },
  { chave: 'pis_cst', grupo: 'fiscal', rotulo: 'CST PIS/COFINS', tipo: 'text', avancado: true,
    ajuda: 'Opcional. Deixe em branco a menos que a contadora peça (ex.: 00 ou 01).' },
  { chave: 'ibs_incluir', grupo: 'fiscal', rotulo: 'Informar grupo IBS/CBS (Reforma Tributária)', tipo: 'select',
    obrigatorio: true, padrao: '1', opcoes: [['1', 'Sim'], ['0', 'Não']], avancado: true },
  { chave: 'ibs_cind_op', grupo: 'fiscal', rotulo: 'IBS/CBS — indicador da operação (cIndOp)', tipo: 'text',
    padrao: '100301', avancado: true, ajuda: 'Seis dígitos. Confirme com a contadora.' },
  { chave: 'ibs_cst', grupo: 'fiscal', rotulo: 'IBS/CBS — CST', tipo: 'text', padrao: '000', avancado: true,
    ajuda: 'Confirme com a contadora (serviços de saúde podem ter redução).' },
  { chave: 'ibs_cclass', grupo: 'fiscal', rotulo: 'IBS/CBS — classificação tributária (cClassTrib)', tipo: 'text',
    padrao: '000001', avancado: true, ajuda: 'Seis dígitos. Confirme com a contadora.' },
  { chave: 'fiscal_conferido', grupo: 'fiscal', rotulo: 'A contadora conferiu os dados fiscais acima', tipo: 'checkbox',
    padrao: '0', ajuda: 'Obrigatório para passar a emitir notas reais.' },

  // ── Emissão ────────────────────────────────────────────────────────
  { chave: 'discriminacao_modelo', grupo: 'emissao', rotulo: 'Texto da nota (discriminação)', tipo: 'textarea',
    obrigatorio: true, padrao: 'Consulta médica realizada em {data}. {beneficiario}',
    ajuda: 'Use {data} para a data do atendimento e {beneficiario} para incluir o nome do paciente quando ele ' +
      'não for quem paga. Nunca coloque diagnóstico, CID ou medicamentos.' },
  { chave: 'valor_padrao', grupo: 'emissao', rotulo: 'Valor padrão da consulta (R$)', tipo: 'money',
    ajuda: 'Usado quando o paciente não tem um valor próprio cadastrado.' },
  { chave: 'serie', grupo: 'emissao', rotulo: 'Série das notas', tipo: 'text', obrigatorio: true, padrao: '00001',
    avancado: true, ajuda: 'Cinco dígitos. Só altere se a contadora orientar.' },
  { chave: 'proximo_ndps_homologacao', grupo: 'emissao', rotulo: 'Próximo número (teste)', tipo: 'int',
    obrigatorio: true, padrao: '1', avancado: true },
  { chave: 'proximo_ndps_producao', grupo: 'emissao', rotulo: 'Próximo número (real)', tipo: 'int',
    obrigatorio: true, padrao: '1', avancado: true,
    ajuda: 'Se a empresa já emitiu notas por outro sistema com a mesma série, comece depois do último número usado.' },

  // ── Backup ─────────────────────────────────────────────────────────
  { chave: 'backup_pasta', grupo: 'backup', rotulo: 'Pasta de backup', tipo: 'folder',
    ajuda: 'De preferência uma pasta sincronizada (Google Drive, OneDrive). O backup é feito ao fechar o programa.' },
];

// Chaves internas (não aparecem no formulário)
const INTERNAS = {
  ambiente: 'homologacao',
  cert_senha: '',
  cert_info: '',
};

const GRUPOS = {
  empresa: 'Dados da empresa',
  fiscal: 'Dados fiscais — preencher junto com a contadora',
  emissao: 'Emissão',
  backup: 'Backup',
};

class Config {
  constructor(db) {
    this.db = db;
  }

  get(chave) {
    const r = this.db.get('SELECT valor FROM config WHERE chave = ?', [chave]);
    if (r) return r.valor;
    const campo = CAMPOS.find((c) => c.chave === chave);
    if (campo) return campo.padrao ?? '';
    return INTERNAS[chave] ?? '';
  }

  set(chave, valor) {
    this.db.run('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor',
      [chave, valor == null ? '' : String(valor)]);
  }

  setMany(obj) {
    this.db.tx(() => {
      for (const [k, v] of Object.entries(obj)) this.set(k, v);
    });
  }

  all() {
    const out = { ...INTERNAS };
    for (const c of CAMPOS) out[c.chave] = c.padrao ?? '';
    for (const r of this.db.all('SELECT chave, valor FROM config')) out[r.chave] = r.valor;
    return out;
  }

  /** Lista de pendências que impedem emitir. */
  pendencias() {
    const cfg = this.all();
    const p = [];
    for (const c of CAMPOS) {
      if (c.obrigatorio && !String(cfg[c.chave] ?? '').trim()) p.push(`Preencha "${c.rotulo}" em Configurações.`);
    }
    if (!cfg.cert_info) p.push('Instale o certificado digital em Configurações.');
    return p;
  }
}

module.exports = { Config, CAMPOS, GRUPOS };
