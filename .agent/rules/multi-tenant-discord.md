---
trigger: always_on
description: Diretrizes de arquitetura multi-tenant para bots de Discord com banco de dados centralizado
---

# Diretrizes Multi-Tenant & Discord Bot Architecture

Este projeto opera como um bot multi-tenant (vários servidores de Discord compartilhando a mesma base de dados SQLite/Prisma e integração com Battle.net). Para evitar erros de menção, dados cruzados ou travamento de UI, siga estritamente estas regras:

## 1. Verificação de Presença Antes de Menções (<@ID>)
- **Regra:** Nunca assuma que um usuário registrado no banco de dados (`User` ou `Character`) está presente no servidor Discord atual.
- **Por quê:** O usuário pode ter feito o vínculo (`/vincular`) em outro servidor compartilhado pelo bot. Mencionar `<@ID>` de um membro ausente resulta em `@deleted-user` ou IDs crus que não notificam ninguém e quebram a estética da mensagem.
- **Padrão Obrigatório:**
  ```javascript
  let isMemberInGuild = false;
  if (registeredChar?.discordId) {
      const member = await guild.members.fetch(registeredChar.discordId).catch(() => null);
      isMemberInGuild = Boolean(member);
  }
  // Se presente: mencione <@ID>; se ausente: use apenas o nome in-game em negrito (**Nome**)
  ```

## 2. Escopo de Cargos e Canais
- Todo cargo (`RoleId`) e canal (`ChannelId`) pertence estritamente a uma única guilda (`guildId`).
- Nunca tente aplicar um cargo ou enviar mensagens para um canal sem garantir que ele pertence à guilda em processamento (`guild.id === config.guildId`).

## 3. Transações Atômicas no SQLite (`prisma.$transaction`)
- O SQLite trabalha com lock de arquivo único para escrita.
- Nunca execute loops com múltiplos `await prisma.model.upsert()` sequenciais soltos (ex: 13 classes + 14 profissões = 27 operações individuais).
- **Sempre agrupe em lote** com `prisma.$transaction(operations)`. Isso reduz o tempo de gravação de 1,5s para menos de 20ms e evita bloqueio do banco.

## 4. UI Dashboard: Feedback Imediato & Sem Poluição
- **Feedback Imediato:** Qualquer botão de ação (`Salvar`, `Validar`, `Executar`) deve imediatamente:
  - Ficar desabilitado (`disabled = true`)
  - Exibir estado de carregamento / spinner
  - Evitar múltiplos cliques concorrentes
- **Hot Reloads Silenciosos:** Filtros visuais de selects (ex: selecionar categoria e recarregar canais) devem ser **silenciosos no front-end**. Nunca dispare toasts desnecessários para operações que são apenas filtros de interface.

## 5. Multi-Expansão da Blizzard API
- A API da Blizzard divide os reinos em namespaces diferentes:
  - `profile-forever-us`: WoW Forever
  - `profile-classic-us`: MoP Classic / Classic Progression
  - `profile-classic1x-us`: Classic Era
  - `profile-us`: Retail
- O resumo da conta (`/profile/user/wow`) **não inclui dados de guilda**. Para hidratar guildas e ranks, consulte o perfil individual (`/profile/wow/character/...`).
