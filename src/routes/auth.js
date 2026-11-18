import { Router } from 'express';
import { prisma } from '../services/db.js';
import { exchangeCodeForToken, getUserProfile, getWoWCharacters, fetchCharacterDetails, fetchCharacterProfessions } from '../services/bnetService.js';
import { sendAuthComplete } from '../bot/notifyAuthComplete.js';

const router = Router();

function renderPage(title, message, isError = false, battletag = null) {
    const bgEffect = isError
        ? 'radial-gradient(circle at 50% 20%, rgba(220, 53, 69, 0.25), transparent 60%)'
        : 'radial-gradient(circle at 50% 20%, rgba(0, 112, 222, 0.25), transparent 60%)';
    const tagBadge = battletag ? `<div class="tag">${battletag}</div>` : '';

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>WoW GuildHub - ${title}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
    body {
      margin: 0; background: #0b0f19; color: #fff; font-family: 'Inter', sans-serif;
      display: flex; align-items: center; justify-content: center; min-height: 100vh;
      background-image: ${bgEffect};
    }
    .card {
      background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(20px); border-radius: 20px; padding: 48px; max-width: 440px;
      text-align: center; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    }
    h1 { font-size: 26px; margin: 0 0 12px; }
    p { color: #94a3b8; font-size: 15px; line-height: 1.6; margin: 0 0 24px; }
    .tag {
      display: inline-block; background: rgba(0, 112, 222, 0.2); border: 1px solid #0070de;
      color: #60a5fa; padding: 6px 16px; border-radius: 999px; font-weight: 600; margin-bottom: 24px;
    }
    .btn {
      display: block; width: 100%; padding: 14px 0; border-radius: 12px; background: #0070de;
      color: #fff; text-decoration: none; font-weight: 600; font-size: 15px; cursor: pointer;
      border: none; transition: background 0.2s;
    }
    .btn:hover { background: #005bb5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    ${tagBadge}
    <button class="btn" onclick="window.close()">Fechar esta aba</button>
  </div>
</body>
</html>`;
}

// Início do redirecionamento
router.get('/', async (req, res) => {
    const { state } = req.query;

    if (!state) {
        return res.status(400).send('Parâmetro state ausente.');
    }

    const authState = await prisma.authState.findUnique({
        where: { state }
    });

    if (!authState) {
        return res.status(404).send('Sessão expirada ou inválida. Gere um novo link no Discord com /vincular.');
    }

    const clientId = process.env.BNET_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.BNET_CALLBACK_URL);

    // Escopo wow.profile para ler contas e personagens do World of Warcraft
    const bnetAuthorizeUrl = `https://oauth.battle.net/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=wow.profile&state=${state}`;

    res.redirect(bnetAuthorizeUrl);
});

// Callback pós-autorização da Battle.net
router.get('/callback', async (req, res) => {
    const { code, state } = req.query;

    if (!code || !state) {
        return res.status(400).send(renderPage('Erro', 'Parâmetros de autenticação inválidos ou incompletos.', true));
    }

    try {
        const authState = await prisma.authState.findUnique({
            where: { state }
        });

        if (!authState) {
            return res.status(400).send(renderPage('Sessão Expirada', 'Essa solicitação de vínculo expirou. Volte ao Discord e use /vincular novamente.', true));
        }

        // 1. Troca o código pelo access token
        const accessToken = await exchangeCodeForToken(code);

        // 2. Busca perfil da conta (BattleTag e ID)
        const userInfo = await getUserProfile(accessToken);
        if (!userInfo || !userInfo.id) {
            return res.status(400).send(renderPage('Falha na Autenticação', 'Não foi possível resgatar seu perfil da Battle.net.', true));
        }

        // 3. Salva ou atualiza os dados do usuário
        await prisma.user.upsert({
            where: { discordId: authState.discordId },
            update: {
                bnetId: userInfo.id,
                battleTag: userInfo.battletag,
                accessToken
            },
            create: {
                discordId: authState.discordId,
                bnetId: userInfo.id,
                battleTag: userInfo.battletag,
                accessToken
            }
        });

        // 4. Identifica o flavor configurado para a guilda (padrão: forever)
        let flavor = 'forever';
        if (authState.guildId) {
            const guildCfg = await prisma.guildConfig.findUnique({
                where: { guildId: authState.guildId }
            });
            if (guildCfg?.gameFlavor) {
                flavor = guildCfg.gameFlavor;
            }
        }

        // 5. Coleta os personagens do WoW na Battle.net
        const characters = await getWoWCharacters(accessToken, flavor);

        for (const char of characters) {
            let guildName = char.guildName;
            let guildId = char.guildId;

            // Busca detalhes da guilda e status atualizado caso não venha no resumo
            if (!guildName && (char.gameFlavor === flavor || char.gameFlavor === 'forever' || (char.level && char.level >= 10))) {
                try {
                    const details = await fetchCharacterDetails(char.name, char.surname, char.realm, char.gameFlavor);
                    if (details?.guildName) {
                        guildName = details.guildName;
                        guildId = details.guildId;
                    }
                } catch (e) { }
            }

            // 1. Procura se o personagem já existe pré-hidratado da guilda (ou já cadastrado)
            const existingChar = await prisma.character.findFirst({
                where: {
                    OR: [
                        ...(char.raw?.id ? [{ blizzardCharId: char.raw.id }] : []),
                        {
                            name: char.name,
                            realm: char.realm,
                            surname: char.surname || null
                        }
                    ]
                }
            });

            let dbChar;
            if (existingChar) {
                // Associa o personagem pré-hidratado ao discordId do jogador que acabou de logar
                dbChar = await prisma.character.update({
                    where: { id: existingChar.id },
                    data: {
                        discordId: authState.discordId,
                        blizzardCharId: char.raw?.id || existingChar.blizzardCharId,
                        level: char.level || existingChar.level,
                        playableClass: char.playableClass || existingChar.playableClass,
                        playableRace: char.playableRace || existingChar.playableRace,
                        guildId: guildId ? Number(guildId) : existingChar.guildId,
                        guildName: guildName || existingChar.guildName,
                        guildRank: char.guildRank ?? existingChar.guildRank
                    }
                });
            } else {
                // Cadastra novo personagem caso não estivesse no roster pré-hidratado
                dbChar = await prisma.character.create({
                    data: {
                        discordId: authState.discordId,
                        blizzardCharId: char.raw?.id || null,
                        name: char.name,
                        surname: char.surname || null,
                        realm: char.realm,
                        gameFlavor: char.gameFlavor,
                        level: char.level,
                        playableClass: char.playableClass,
                        playableRace: char.playableRace,
                        guildId: guildId ? Number(guildId) : null,
                        guildName: guildName,
                        guildRank: char.guildRank
                    }
                });
            }

            // Resgata e salva as profissões do personagem caso ainda não existam
            const existingProfsCount = await prisma.profession.count({ where: { characterId: dbChar.id } });
            if (existingProfsCount === 0 && (char.gameFlavor === 'forever' || char.gameFlavor === 'retail')) {
                try {
                    const profs = await fetchCharacterProfessions(char.name, char.surname, char.realm, char.gameFlavor);
                    for (const p of profs) {
                        await prisma.profession.upsert({
                            where: { characterId_name: { characterId: dbChar.id, name: p.name } },
                            update: { skillPoints: p.skillPoints, maxSkill: p.maxSkill, isPrimary: p.isPrimary },
                            create: { characterId: dbChar.id, name: p.name, skillPoints: p.skillPoints, maxSkill: p.maxSkill, isPrimary: p.isPrimary }
                        });
                    }
                } catch (pErr) { }
            }
        }

        const originGuildId = authState.guildId;

        // 6. Remove a sessão temporária de state
        await prisma.authState.delete({
            where: { state }
        });

        // 7. Notifica o bot para enviar a DM de seleção de Main filtrada pelo servidor de origem
        sendAuthComplete(authState.discordId, originGuildId).catch(console.error);

        res.send(renderPage('Vínculo Concluído!', 'Sua conta da Battle.net foi vinculada com sucesso! Verifique suas mensagens privadas no Discord para selecionar seu personagem principal.', false, userInfo.battletag));

    } catch (error) {
        console.error('[OAuth Callback] Erro durante processamento:', error?.response?.data || error);
        res.status(500).send(renderPage('Erro no Processamento', 'Houve uma falha técnica ao autenticar com a Battle.net.', true));
    }
});

export default router;
