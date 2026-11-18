import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { prisma } from '../services/db.js';

/**
 * Gerencia o ciclo de vida das Panelinhas (Salas de Voz Dinâmicas).
 * - Ao entrar no canal gerador configurado, cria uma sala privada na categoria definida e move o membro.
 * - Concede poderes de dono da sala (mover, mutar, renomear canal).
 * - Quando todos saem da sala (members.size === 0), exclui o canal automaticamente.
 */
export async function handleVoiceStateUpdate(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;

    try {
        const guildConfig = await prisma.guildConfig.findUnique({
            where: { guildId: guild.id }
        });

        if (!guildConfig || !guildConfig.panelinhaCategoryId || !guildConfig.panelinhaGeneratorChannelId) {
            return;
        }

        const generatorChannelId = guildConfig.panelinhaGeneratorChannelId;
        const categoryId = guildConfig.panelinhaCategoryId;

        // 1. Membro entrou no Canal Gerador
        if (newState.channelId === generatorChannelId) {
            const member = newState.member;
            if (!member) return;

            const userName = member.nickname || member.user.displayName || member.user.username;
            const channelName = `🔊┃Panelinha do ${userName}`;

            console.log(`[Panelinha] ${member.user.tag} criando sala: ${channelName}`);

            const newChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildVoice,
                parent: categoryId,
                bitrate: Math.min(96000, guild.maximumBitrate || 96000),
                permissionOverwrites: [
                    {
                        id: guild.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.Connect,
                            PermissionFlagsBits.Speak,
                            PermissionFlagsBits.UseVAD,
                            PermissionFlagsBits.Stream
                        ]
                    },
                    {
                        id: member.id,
                        allow: [
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.MoveMembers,
                            PermissionFlagsBits.MuteMembers,
                            PermissionFlagsBits.DeafenMembers,
                            PermissionFlagsBits.PrioritySpeaker
                        ]
                    }
                ]
            });

            // Move o membro imediatamente para sua nova sala
            await newState.setChannel(newChannel, 'Entrou na sua Panelinha recém-criada');
        }

        // 2. Limpeza automática: membro saiu de um canal
        if (oldState.channelId) {
            const oldChannel = oldState.channel;
            if (
                oldChannel &&
                oldChannel.parentId === categoryId &&
                oldChannel.id !== generatorChannelId &&
                oldChannel.members.size === 0
            ) {
                console.log(`[Panelinha] Sala vazia detectada. Excluindo: ${oldChannel.name}`);
                await oldChannel.delete('Panelinha temporária encerrada (sala vazia)').catch(err => {
                    console.warn(`[Panelinha] Falha ao excluir canal ${oldChannel.id}:`, err.message);
                });
            }
        }
    } catch (err) {
        console.error('[Panelinha] Erro no processamento de voz:', err);
    }
}
