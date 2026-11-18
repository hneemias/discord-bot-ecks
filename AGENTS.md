# Regras e Diretrizes do Projeto (bot-guild-projeto)

Este repositório contém um bot Discord multi-tenant integrado à Battle.net e WoW (Forever, Classic e Retail) com painel web Express/Tailwind.

Ao trabalhar neste projeto, todo agente de IA **deve respeitar** as seguintes regras fundamentais:

1. **Multi-Tenant Discord Guild Boundary:**
   - O banco de dados SQLite (`User`, `Character`) armazena membros globalmente.
   - **NUNCA mencione `<@discordId>` sem antes validar se o membro está no servidor atual:**
     ```javascript
     const member = await guild.members.fetch(discordId).catch(() => null);
     ```
   - Se o usuário não estiver presente no servidor de destino, exiba apenas o nome do personagem do jogo (`**Nome**`), evitando marcações de `@deleted-user` ou IDs soltos.

2. **SQLite Performance & Prisma Transactions:**
   - Evite múltiplos `await prisma.model.upsert()` sequenciais dentro de loops para salvar formulários.
   - **Sempre utilize `prisma.$transaction(operations)`** para garantir gravações atômicas em menos de 20ms, evitando travas no arquivo SQLite.

3. **Dashboard Web UX:**
   - Botões de submissão (`Salvar`, `Validar`) devem bloquear cliques duplos instantaneamente (`disabled = true`, spinner).
   - Filtros de select (hot-reloads locais, como Categoria ➔ Canais de Voz) devem ser **completamente silenciosos** (sem disparar toasts).

4. **Blizzard API Namespaces:**
   - Nunca consulte apenas um único namespace em `/profile/user/wow`. Sempre consulte `profile-forever-us`, `profile-classic-us`, `profile-classic1x-us` e `profile-us` para cobrir o roster completo.
   - O resumo da conta Blizzard não inclui guildas. Use `fetchCharacterDetails` para obter a guilda e o `guildId` numérico.
