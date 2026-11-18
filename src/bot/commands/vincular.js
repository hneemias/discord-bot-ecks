import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { prisma } from '../../services/db.js';
import crypto from 'crypto';

export const data = new SlashCommandBuilder()
    .setName('vincular')
    .setDescription('Conecte sua conta Battle.net e verifique seus personagens do WoW.');

export async function execute(interaction) {
    const discordId = interaction.user.id;
    const guildId = interaction.guildId;

    // Gera state criptográfico único para segurança anti-CSRF
    const state = crypto.randomBytes(16).toString('hex');

    await prisma.authState.create({
        data: {
            state,
            discordId,
            guildId
        }
    });

    const publicUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`;
    const authUrl = `${publicUrl}/auth/bnet?state=${state}`;

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('⚔️ Entrar com Battle.net')
            .setURL(authUrl)
            .setStyle(ButtonStyle.Link)
    );

    await interaction.reply({
        content: 'Clique no botão abaixo para vincular sua conta da Battle.net com segurança.\nApós autorizar no navegador, você receberá um menu privado para escolher o seu **Main Character**!',
        components: [row],
        ephemeral: true
    });
}
