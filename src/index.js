import 'dotenv/config';
import { startServer } from './server.js';
import { loginBot } from './bot/client.js';
import { startGuildNewsScheduler } from './services/guildNewsService.js';
import './bot/events.js';

async function bootstrap() {
    console.log('==============================================');
    console.log('   WoW Forever & Guild Discord Bot Iniciando  ');
    console.log('==============================================');

    // 1. Inicia o servidor HTTP para OAuth2 e Webhooks
    startServer();

    // 2. Conecta o Bot do Discord
    await loginBot();

    // 3. Inicia o agendador de Guild News (Level-ups & Conquistas)
    startGuildNewsScheduler();
}

bootstrap().catch(err => {
    console.error('[Bootstrap] Falha crítica na inicialização:', err);
});
