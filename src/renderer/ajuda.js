// Ajuda exibida dentro do programa (mesmo conteúdo do tutorial impresso).
window.AJUDA_HTML = `
<h1>Como usar</h1>
<p>Este programa emite as notas fiscais de serviço (NFS-e) do consultório direto na Prefeitura de Campinas, usando o certificado digital da empresa. Cada nota emitida fica guardada aqui, em PDF e XML, para enviar ao paciente e à contadora.</p>

<h2>Primeira configuração (uma vez só)</h2>
<p>Separe antes: o arquivo do certificado digital (termina em <strong>.pfx</strong> ou <strong>.p12</strong>, normalmente enviado por e-mail pela certificadora), a senha dele, o cartão CNPJ e a inscrição municipal da empresa.</p>
<ol>
  <li>Abra <strong>Configurações</strong>.</li>
  <li>Em <strong>Certificado digital</strong>, digite a senha do certificado e clique em <strong>Escolher arquivo do certificado</strong>. Se aparecer "Senha do certificado incorreta", confira maiúsculas e minúsculas.</li>
  <li>Em <strong>Dados da empresa</strong>, preencha razão social, CNPJ e inscrição municipal.</li>
  <li>Na seção <strong>Dados fiscais</strong>, preencha junto com a contadora. Os campos já vêm com sugestões, mas é ela quem confirma o regime tributário, os códigos e a alíquota.</li>
  <li>Em <strong>Emissão</strong>, ajuste o valor padrão da consulta e, se quiser, o texto que vai na nota.</li>
  <li>Em <strong>Backup</strong>, escolha uma pasta sincronizada com a nuvem (Google Drive ou OneDrive). O programa faz uma cópia de tudo cada vez que é fechado.</li>
  <li>Clique em <strong>Salvar configurações</strong>.</li>
</ol>

<h2>Testar antes de emitir notas reais</h2>
<p>O programa começa no <strong>modo de teste</strong> (faixa amarela listrada no alto). Notas de teste vão para o ambiente de testes da prefeitura e não valem nada, então pode errar à vontade.</p>
<ol>
  <li>Cadastre um paciente e emita duas ou três notas de teste.</li>
  <li>Se a prefeitura recusar, leia a mensagem. Se ela falar de código, alíquota, regime ou CNAE, mostre à contadora e ajuste em Configurações.</li>
  <li>Quando as notas de teste saírem como <strong>Emitida</strong>, marque em Configurações a opção <strong>A contadora conferiu os dados fiscais</strong>.</li>
  <li>Pergunte à contadora se a empresa já emitiu notas pelo site da prefeitura. Se sim, ela informa a série e o próximo número a usar (Configurações → Emissão → Opções avançadas).</li>
  <li>Clique em <strong>Passar a emitir notas reais</strong> na faixa do alto. A faixa fica verde: a partir daí, as notas valem.</li>
</ol>

<h2>Uso diário</h2>
<h3>Emitir uma nota</h3>
<ol>
  <li>Em <strong>Emitir nota</strong>, digite o nome ou CPF de quem pagou e escolha na lista (setas e Enter também funcionam).</li>
  <li>Confira o valor (vem preenchido com o da última nota da pessoa) e a data do atendimento.</li>
  <li>Clique em <strong>Emitir agora</strong>. Em alguns segundos aparece o carimbo <strong>EMITIDA</strong> com o número da nota.</li>
  <li>Clique em <strong>Abrir PDF</strong> ou <strong>Mostrar na pasta</strong> para enviar ao paciente por e-mail ou WhatsApp (basta arrastar o arquivo).</li>
</ol>
<h3>Emitir várias de uma vez (fila)</h3>
<p>Durante o dia, use <strong>Adicionar à fila</strong> em vez de emitir. No fim do dia, clique em <strong>Emitir todas</strong> e espere terminar sem fechar o programa.</p>
<h3>Quando quem paga não é o paciente</h3>
<p>Exemplo: a mãe paga a consulta da filha. Cadastre a <strong>mãe</strong> como quem paga e marque <strong>O paciente é outra pessoa</strong>, preenchendo nome, CPF e nascimento da filha. A nota sai no nome da mãe, com o nome da filha no texto, que é o que a Receita pede para a dedução no Imposto de Renda.</p>
<h3>Paciente novo</h3>
<p>Na tela Emitir nota, clique em <strong>Cadastrar novo paciente</strong>. Também dá para importar uma planilha com vários pacientes em <strong>Pacientes → Importar planilha</strong>.</p>

<h2>Situações de uma nota</h2>
<table>
  <thead><tr><th>Situação</th><th>O que significa</th><th>O que fazer</th></tr></thead>
  <tbody>
    <tr><td><span class="selo autorizada">Emitida</span></td><td>A prefeitura aceitou. A nota vale.</td><td>Nada. Envie o PDF ao paciente.</td></tr>
    <tr><td><span class="selo rejeitada">Recusada</span></td><td>A prefeitura não aceitou e explicou o motivo. Nenhuma nota foi gerada.</td><td>Leia o motivo, corrija (cadastro do paciente, valor ou data) e clique em <strong>Corrigir e reenviar</strong>.</td></tr>
    <tr><td><span class="selo incerta">A verificar</span></td><td>A internet ou o site da prefeitura falhou no meio do envio. Não sabemos ainda se a nota foi registrada.</td><td>Clique em <strong>Verificar</strong>. O programa pergunta à prefeitura e só reenvia se tiver certeza de que a nota não existe.</td></tr>
    <tr><td><span class="selo rascunho">Não enviada</span></td><td>Está na fila ou foi liberada para reenvio.</td><td>Clique em <strong>Emitir</strong>.</td></tr>
    <tr><td><span class="selo cancelada">Cancelada</span></td><td>Foi cancelada na prefeitura.</td><td>Nada.</td></tr>
  </tbody>
</table>
<p><strong>Importante:</strong> nunca emita pelo site da prefeitura uma nota que aqui está "A verificar". Isso pode gerar nota duplicada. Use sempre o botão Verificar. Quando o programa é aberto, ele também verifica sozinho as notas que ficaram pendentes.</p>

<h2>Cancelar uma nota</h2>
<p>Em <strong>Notas emitidas</strong>, clique em <strong>Cancelar</strong> na linha da nota, escolha o motivo e escreva uma explicação curta (mínimo de 15 letras). Se o problema era o valor ou o paciente, emita em seguida uma nota nova correta.</p>

<h2>Todo mês e todo ano</h2>
<ul>
  <li><strong>Começo de cada mês:</strong> em <strong>Contadora e DMED</strong>, gere o pacote do mês anterior e envie o arquivo .zip para a contadora.</li>
  <li><strong>Janeiro e fevereiro:</strong> gere a planilha da DMED do ano anterior e envie para a contadora. A DMED informa à Receita quanto cada CPF pagou no ano.</li>
</ul>

<h2>Certificado digital vencendo</h2>
<p>O certificado A1 vale um ano. Faltando 30 dias, aparece um aviso amarelo na tela de emissão. Renove com a certificadora; quando chegar o arquivo novo, vá em Configurações, digite a nova senha e clique em <strong>Trocar certificado</strong>. Guarde sempre uma cópia do arquivo do certificado num lugar seguro (pendrive ou e-mail), fora deste computador.</p>

<h2>Backup e troca de computador</h2>
<p>O backup é automático ao fechar o programa, na pasta escolhida em Configurações. Os 30 backups mais recentes ficam guardados.</p>
<p>Em um computador novo: instale o programa, vá em <strong>Configurações → Restaurar um backup</strong> e escolha o arquivo mais recente. Depois instale de novo o certificado digital (por segurança, a senha não vai no backup).</p>

<h2>Sigilo</h2>
<p>A nota fiscal é vista pela Prefeitura, pela Receita e por quem pagou. Nunca escreva no texto da nota diagnóstico, CID, nome de medicamento ou motivo da consulta.</p>

<h2>Atualizações e suporte</h2>
<p>O programa se atualiza sozinho pela internet. Quando houver uma versão nova, aparece um aviso no canto inferior do menu e ela é instalada ao fechar o programa.</p>
<p>Se algo der errado e não estiver explicado aqui, vá em <strong>Configurações → Gerar arquivo de diagnóstico</strong> e envie o arquivo que aparecer na Área de Trabalho para quem dá suporte. Nomes e CPFs de pacientes ficam ocultos nesse arquivo.</p>
`;
