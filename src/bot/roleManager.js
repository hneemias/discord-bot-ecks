import { prisma } from '../services/db.js';
import { checkGuildMembership } from '../services/bnetService.js';

/**
 * Aplica o cargo de Não-Verificado (Quarentena) em um membro
 */
export async function applyQuarantine(member, guildConfig) {
    if (!guildConfig || !guildConfig.unverifiedRoleId) return;
    try {
        if (!member.roles.cache.has(guildConfig.unverifiedRoleId)) {
            await member.roles.add(guildConfig.unverifiedRoleId, 'Novo membro em quarentena');
        }
    } catch (err) {
        console.error(`[RoleManager] Falha ao aplicar quarentena no membro ${member.id}:`, err.message);
    }
}

/**
 * Remove o cargo de Não-Verificado (Quarentena)
 */
export async function removeQuarantine(member, guildConfig) {
    if (!guildConfig || !guildConfig.unverifiedRoleId) return;
    try {
        if (member.roles.cache.has(guildConfig.unverifiedRoleId)) {
            await member.roles.remove(guildConfig.unverifiedRoleId, 'Membro verificado com sucesso');
        }
    } catch (err) {
        console.error(`[RoleManager] Falha ao remover quarentena do membro ${member.id}:`, err.message);
    }
}

/**
 * Sincroniza apelido (Nickname), cargo com cor do Main e cargos de acesso de Alts
 */
export async function syncMemberRolesAndNick(member, user, guildConfig) {
    if (!member || !user || !user.mainCharName) return;

    const report = [];

    // 1. Remover quarentena
    await removeQuarantine(member, guildConfig);

    // 2. Aplicar cargo de Verificado
    if (guildConfig?.verifiedRoleId) {
        try {
            if (!member.roles.cache.has(guildConfig.verifiedRoleId)) {
                await member.roles.add(guildConfig.verifiedRoleId, 'Verificação Battle.net concluída');
                report.push('Cargo @Verificado concedido.');
            }
        } catch (e) {
            console.error(`[RoleManager] Erro ao adicionar cargo verificado:`, e.message);
        }
    }

    // 3. Atualizar Nickname
    try {
        let nickname = user.mainCharName;
        if (user.mainCharSurname) {
            nickname = `${user.mainCharName} ${user.mainCharSurname}`;
        } else if (user.mainCharRealm) {
            nickname = `${user.mainCharName}-${user.mainCharRealm}`;
        }

        // Discord limita apelidos a 32 caracteres
        if (nickname.length > 32) {
            nickname = nickname.substring(0, 32);
        }

        await member.setNickname(nickname, 'Atualização de Main Character');
        report.push(`Apelido atualizado para **${nickname}**.`);
    } catch (e) {
        console.warn(`[RoleManager] Não foi possível alterar o nickname do usuário ${member.id} (Pode ser Dono/Staff do servidor).`);
    }

    // 4. Carregar personagens e mapeamentos de classe
    const characters = await prisma.character.findMany({
        where: { discordId: user.discordId }
    });

    const classMappings = await prisma.classRoleMapping.findMany({
        where: { guildId: member.guild.id }
    });

    const mappingMap = new Map();
    for (const m of classMappings) {
        mappingMap.set(m.className.toLowerCase(), m);
    }

    // Identificar a classe do Main
    const mainChar = characters.find(c => c.name.toLowerCase() === user.mainCharName.toLowerCase()) || characters[0];
    const mainClassName = mainChar?.playableClass?.toLowerCase() || '';

    // Todas as classes que o usuário possui (Main + Alts)
    const userClasses = new Set(
        characters.map(c => c.playableClass?.toLowerCase()).filter(Boolean)
    );

    // 5. Aplicar cargo com cor para o MAIN e remover cargos Main de outras classes
    for (const [clsName, mapping] of mappingMap.entries()) {
        if (mapping.mainRoleId) {
            const hasMainRole = member.roles.cache.has(mapping.mainRoleId);
            if (clsName === mainClassName) {
                if (!hasMainRole) {
                    try {
                        await member.roles.add(mapping.mainRoleId, `Classe do Main: ${mainChar?.playableClass}`);
                        report.push(`Cargo Main [Cor]: **${clsName.toUpperCase()}** adicionado.`);
                    } catch (e) { }
                }
            } else if (hasMainRole) {
                try {
                    await member.roles.remove(mapping.mainRoleId, 'Remoção de classe Main anterior');
                } catch (e) { }
            }
        }
    }

    // 6. Aplicar cargos de ACESSO (sem cor / genéricos) para todas as classes que ele possui (incluindo alts)
    for (const [clsName, mapping] of mappingMap.entries()) {
        if (mapping.altRoleId) {
            const hasAltRole = member.roles.cache.has(mapping.altRoleId);
            if (userClasses.has(clsName)) {
                if (!hasAltRole) {
                    try {
                        await member.roles.add(mapping.altRoleId, `Acesso a canais da classe: ${clsName}`);
                        report.push(`Acesso aos canais de classe [Alt]: **${clsName.toUpperCase()}** concedido.`);
                    } catch (e) { }
                }
            } else if (hasAltRole) {
                try {
                    await member.roles.remove(mapping.altRoleId, 'Não possui mais personagens desta classe');
                } catch (e) { }
            }
        }
    }

    // 7. Aplicar cargos de PROFISSÕES
    const userProfessions = await prisma.profession.findMany({
        where: { character: { discordId: user.discordId } }
    });

    const profMappings = await prisma.professionRoleMapping.findMany({
        where: { guildId: member.guild.id }
    });

    const userProfNames = new Set(
        userProfessions.map(p => p.name.toLowerCase())
    );

    for (const pMapping of profMappings) {
        if (pMapping.roleId) {
            const hasRole = member.roles.cache.has(pMapping.roleId);
            if (userProfNames.has(pMapping.professionName.toLowerCase())) {
                if (!hasRole) {
                    try {
                        await member.roles.add(pMapping.roleId, `Profissão detectada: ${pMapping.professionName}`);
                        report.push(`Cargo de Profissão: **${pMapping.professionName}** concedido.`);
                    } catch (e) { }
                }
            } else if (hasRole) {
                try {
                    await member.roles.remove(pMapping.roleId, 'Não possui mais esta profissão');
                } catch (e) { }
            }
        }
    }

    // 8. Sincronizar Cargo da GUILDA e PATENTES (Rank 0 = GM, Rank 1 = Oficial)
    if (guildConfig?.targetGuildName || guildConfig?.targetGuildId) {
        const targetGuildId = guildConfig.targetGuildId;
        const targetGuildName = guildConfig.targetGuildName?.toLowerCase();

        // Localiza personagem do usuário que pertence à guilda oficial
        let guildChar = characters.find(c =>
            (targetGuildId && c.guildId === targetGuildId) ||
            (targetGuildName && c.guildName?.toLowerCase() === targetGuildName)
        );

        // Se ainda não temos o rank confirmado, consulta o roster oficial
        if (guildChar && guildChar.guildRank === null && guildConfig.targetGuildName) {
            try {
                const membership = await checkGuildMembership(
                    guildConfig.targetGuildName,
                    guildChar.name,
                    guildChar.surname,
                    guildChar.realm,
                    guildConfig.gameFlavor || 'forever'
                );
                if (membership.isMember) {
                    guildChar.guildRank = membership.rank;
                    await prisma.character.update({
                        where: { id: guildChar.id },
                        data: { guildRank: membership.rank }
                    }).catch(() => { });
                }
            } catch (e) { }
        }

        const isMemberOfGuild = Boolean(guildChar);
        const rank = guildChar?.guildRank;

        // Cargo de Membro da Guilda
        if (guildConfig.targetGuildRoleId) {
            const hasGuildRole = member.roles.cache.has(guildConfig.targetGuildRoleId);
            if (isMemberOfGuild) {
                if (!hasGuildRole) {
                    try {
                        await member.roles.add(guildConfig.targetGuildRoleId, `Membro verificado da guilda oficial: ${guildConfig.targetGuildName}`);
                        report.push(`Cargo da Guilda: **${guildConfig.targetGuildName}** concedido.`);
                    } catch (e) { }
                }
            } else if (hasGuildRole) {
                try {
                    await member.roles.remove(guildConfig.targetGuildRoleId, 'Não é mais membro da guilda oficial');
                } catch (e) { }
            }
        }

        // Cargo de Líder da Guilda / GM (Rank 0)
        if (guildConfig.guildLeaderRoleId) {
            const hasGmRole = member.roles.cache.has(guildConfig.guildLeaderRoleId);
            if (isMemberOfGuild && rank === 0) {
                if (!hasGmRole) {
                    try {
                        await member.roles.add(guildConfig.guildLeaderRoleId, 'Líder / GM oficial da guilda');
                        report.push(`👑 Cargo de **Guild Master** concedido.`);
                    } catch (e) { }
                }
            } else if (hasGmRole) {
                try {
                    await member.roles.remove(guildConfig.guildLeaderRoleId, 'Não é mais Guild Master');
                } catch (e) { }
            }
        }

        // Cargo de Oficial da Guilda (Rank 1)
        if (guildConfig.guildOfficerRoleId) {
            const hasOfficerRole = member.roles.cache.has(guildConfig.guildOfficerRoleId);
            if (isMemberOfGuild && rank === 1) {
                if (!hasOfficerRole) {
                    try {
                        await member.roles.add(guildConfig.guildOfficerRoleId, 'Oficial oficial da guilda');
                        report.push(`🛡️ Cargo de **Oficial da Guilda** concedido.`);
                    } catch (e) { }
                }
            } else if (hasOfficerRole) {
                try {
                    await member.roles.remove(guildConfig.guildOfficerRoleId, 'Não é mais Oficial da guilda');
                } catch (e) { }
            }
        }
    }

    return report;
}

/**
 * Processa a entrada de um membro (guildMemberAdd).
 * Se o membro já era verificado e saiu/voltou (ou já se vinculou em outro servidor com o bot),
 * restaura e aplica todos os cargos e apelido automaticamente!
 */
export async function handleMemberJoin(member) {
    const guildConfig = await prisma.guildConfig.findUnique({
        where: { guildId: member.guild.id }
    });

    const dbUser = await prisma.user.findUnique({
        where: { discordId: member.id }
    });

    if (dbUser) {
        let userToSync = dbUser;

        // Se o usuário ainda não tiver um Main explícito, detecta o personagem de maior nível
        if (!userToSync.mainCharName) {
            const userChars = await prisma.character.findMany({
                where: { discordId: member.id },
                orderBy: { level: 'desc' }
            });

            if (userChars.length > 0) {
                const serverFlavor = guildConfig?.gameFlavor || 'forever';
                const flavorMatch = userChars.find(c => {
                    if (serverFlavor === 'forever') return Boolean(c.surname);
                    return !c.surname;
                }) || userChars[0];

                userToSync = await prisma.user.update({
                    where: { discordId: member.id },
                    data: {
                        mainCharName: flavorMatch.name,
                        mainCharSurname: flavorMatch.surname,
                        mainCharRealm: flavorMatch.realm
                    }
                });

                await prisma.character.update({
                    where: { id: flavorMatch.id },
                    data: { isMain: true }
                });
            }
        }

        if (userToSync.mainCharName) {
            console.log(`[RoleManager] Membro conhecido entrou no servidor ${member.guild.name}: ${member.user.tag} (${userToSync.mainCharName})`);
            const report = await syncMemberRolesAndNick(member, userToSync, guildConfig);

            // Envia uma DM amigável avisando sobre o auto-reconhecimento
            try {
                await member.send({
                    content: `👋 Bem-vindo ao **${member.guild.name}**!\n🛡️ Como você já possui sua conta da Battle.net vinculada ao bot, seus cargos e apelido (**${userToSync.mainCharName}**) foram aplicados automaticamente!\n\n💡 Se desejar alternar seu personagem principal neste servidor, basta usar o comando \`/alterar_main\`.`
                });
            } catch (e) {
                // DM bloqueada pelo usuário, segue normalmente
            }
            return;
        }
    }

    // Caso o membro seja desconhecido pelo bot, aplica a quarentena
    await applyQuarantine(member, guildConfig);
}
