import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
app.use(express.json());

// Servir frontend estático do Dashboard
app.use(express.static(path.join(__dirname, 'public')));

// Rotas da API Administrativa e OAuth2 Battle.net
app.use('/auth/bnet', authRoutes);
app.use('/api', apiRoutes);

// Rota amigável do dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check simples
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;

export function startServer() {
    return app.listen(PORT, () => {
        console.log(`[Express] Servidor web rodando na porta ${PORT}`);
        console.log(`[Dashboard] Painel Administrativo disponível em: http://localhost:${PORT}/dashboard`);
    });
}
