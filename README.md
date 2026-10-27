# Notas do Consultório

Emissor mínimo de NFS-e para consultório médico em Campinas (Padrão Nacional / DPS v1.01, Reforma Tributária), como app desktop para Windows. Feito para ser usado pela secretária sem terminal: instalador, ícone na área de trabalho, certificado configurado pela tela, atualização automática.

O tutorial para quem usa no dia a dia está dentro do programa (menu **Ajuda**). Este arquivo é o guia técnico, para quem mantém.

## Arquitetura

```
Electron
├── main (Node) ─ toda a lógica fiscal e de dados
│   ├── emissor.js     rascunho → reserva do nº → envio → autorizada / rejeitada / incerta
│   ├── db.js          SQLite via sql.js (WASM; sem módulo nativo, compila em qualquer SO)
│   ├── cert.js        e-CNPJ A1: valida senha, lê CNPJ (OID 2.16.76.1.3.3) e validade
│   ├── config.js      todos os campos de configuração (a tela é gerada a partir daqui)
│   ├── pacientes.js   cadastro + importação CSV
│   ├── relatorios.js  pacote mensal p/ contadora (CSV+XML+PDF em .zip) e base da DMED
│   ├── manutencao.js  backup ao fechar, restauração, diagnóstico com dados mascarados
│   └── ipc.js         canais expostos à tela
├── preload.js ─ contextBridge (a tela não tem acesso a Node)
└── renderer ─ HTML/CSS/JS puro, sem framework nem build
```

A comunicação com a prefeitura é toda feita pela biblioteca [`@4success/nfse-campinas`](https://github.com/4success/nfse-campinas) (v3, Padrão Nacional, endpoints da IMA). Ela monta e assina a DPS, envia, consulta por DPS, consulta NFS-e, cancela (evento 101101) e gera o HTML da DANFSe; o PDF sai do `printToPDF` do próprio Electron.

### Proteção contra nota duplicada

É a parte mais importante do código (`emissor.js`):

1. O número da DPS é reservado e gravado numa transação **antes** do envio (status `enviando`).
2. Timeout, queda de rede ou HTTP 5xx → status `incerta`. Uma nota `incerta` **não pode** ser reenviada diretamente.
3. "Verificar" chama `consultarDps(idDps)`:
   - existe → busca o XML, confere com `assertNfseXmlMatchesDps` e marca `autorizada` (sem reenviar);
   - não existe (404 / alerta "não encontrada") → volta para `rascunho` **com o mesmo número**, e só então reenvia;
   - sem resposta → continua `incerta`.
4. Resposta "já existe" no envio → trata como registrada e vai direto para a consulta.
5. Ao abrir o programa, todas as notas `enviando`/`incerta` são reconciliadas.
6. Rejeição clara (4xx com mensagens) → `rejeitada`; ao corrigir e reenviar, reaproveita o número (não foi registrado).

Numeração separada por ambiente (`proximo_ndps_homologacao` / `proximo_ndps_producao`).

### Onde ficam os dados (Windows)

| O quê | Onde |
|---|---|
| Banco (`notas.db`), certificado, log | `%APPDATA%\Notas do Consultório\` |
| XML e PDF das notas | `Documentos\Notas do Consultório\AAAA-MM\` (testes em `TESTE\`) |
| Backups (30 mais recentes) | pasta escolhida em Configurações, de preferência sincronizada |

A senha do certificado é cifrada com `safeStorage` (DPAPI). Ela não vai no backup: ao restaurar em outro computador, reinstala-se o certificado.

## Desenvolvimento

```bash
npm install
npm test                 # 13 testes: emissão, rejeição, timeout, reconciliação, lote, cancelamento, relatórios, backup
npm start                # abre o programa (dados reais do seu usuário)
npx electron scripts/demo.js   # abre com dados fictícios e prefeitura SIMULADA, numa pasta temporária
```

`scripts/demo.js` usa um certificado autoassinado e um cliente falso da prefeitura (`test/helpers.js`). As variáveis `NFSE_DADOS` (pasta de dados) e `NFSE_SIMULAR` só funcionam fora do instalador.

## Publicar uma versão (atualiza os computadores sozinho)

Uma vez só:

1. Crie o repositório **público** `doutorleandromendes/nfse-consultorio` no GitHub (público porque o programa instalado baixa as atualizações sem login; não há segredo nenhum no código). Se usar outro nome/conta, troque `owner`/`repo` em `electron-builder.yml`.
2. Envie este código (`git init`, `git add .`, `git commit`, `git push`).

A cada versão:

```bash
npm version patch          # 1.0.0 → 1.0.1, cria a tag v1.0.1
git push --follow-tags
```

O GitHub Actions (`.github/workflows/release.yml`) roda os testes num Windows, gera o instalador e publica a Release. Os programas instalados verificam a cada 6 horas e na abertura, baixam em segundo plano e instalam ao fechar.

O instalador inicial pode ser baixado da página de Releases do repositório. Sem certificado de assinatura de código, o Windows mostra o aviso do SmartScreen na primeira instalação ("Mais informações" → "Executar assim mesmo"); as atualizações automáticas não passam por esse aviso.

## Checklist antes de ela emitir notas reais

- [ ] Contadora confirmou: regime (Simples/ME-EPP ou não), regime especial, `cTribNac` (sugestão 040101), NBS, alíquota de ISS e o grupo IBS/CBS (`cIndOp`, CST, `cClassTrib` — os padrões vieram do exemplo da biblioteca; serviços de saúde podem ter CST/classificação de redução).
- [ ] Notas de teste saindo como **Emitida** em homologação.
- [ ] Se a empresa já emitiu notas pelo emissor da prefeitura: definir **série** e **próximo número** sem colidir com os já usados.
- [ ] Pasta de backup escolhida.
- [ ] Marcado "A contadora conferiu os dados fiscais" (sem isso o programa não deixa passar para produção).

## Suporte

Quando algo der errado, peça o **arquivo de diagnóstico** (Configurações → Gerar arquivo de diagnóstico, vai para a Área de Trabalho). Ele traz versão, configuração (sem a senha), pendências, contagem de notas, as últimas 300 trocas com a prefeitura e o log, com CPFs, nomes e e-mails mascarados.

Erros de leiaute ou endpoint da prefeitura normalmente se resolvem atualizando a `@4success/nfse-campinas` (`npm install @4success/nfse-campinas@latest`, rodar os testes, publicar versão).

## Limitações conhecidas

- Um computador só (SQLite local). Para usar em dois, é preciso um servidor, o que muda a arquitetura.
- Sem envio de e-mail pelo próprio programa: o PDF é aberto/mostrado na pasta para enviar por e-mail ou WhatsApp. A prefeitura pode enviar a nota ao e-mail do tomador quando ele está cadastrado.
- A planilha da DMED é a base de cálculo; a declaração em si é feita pela contadora no programa da Receita.
- Cancelamento em produção depende do endpoint da prefeitura (a biblioteca indica disponibilidade desde 21/09/2026).
