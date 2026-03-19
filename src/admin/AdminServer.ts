import express, { Request, Response, NextFunction } from 'express';
import * as path from 'path';
import * as crypto from 'crypto';
import * as si from 'systeminformation';
import { config } from '../utils/config';
import { logger, logBuffer, captureLog } from '../utils/logger';
import { AgentController } from '../agent/AgentController';

const TOKENS = new Set<string>();

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function createAdminServer(controller: AgentController): express.Application {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // Login endpoint
  app.post('/api/login', (req: Request, res: Response) => {
    const { password } = req.body as { password: string };
    if (password === config.admin.password) {
      const token = generateToken();
      TOKENS.add(token);
      // Auto-expire after 24h
      setTimeout(() => TOKENS.delete(token), 24 * 60 * 60 * 1000);
      res.json({ token });
    } else {
      res.status(401).json({ error: 'Invalid password' });
    }
  });

  // Auth middleware for protected routes
  function auth(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    if (!token || !TOKENS.has(token)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  }

  // Status endpoint
  app.get('/api/status', auth, async (_req: Request, res: Response) => {
    try {
      const [cpuLoad, mem] = await Promise.all([
        si.currentLoad(),
        si.mem(),
      ]);

      const agentStatus = controller.getStatus();

      res.json({
        system: {
          cpu: `${cpuLoad.currentLoad.toFixed(1)}%`,
          ram: `${((mem.active / mem.total) * 100).toFixed(1)}% (${(mem.active / 1024 / 1024 / 1024).toFixed(1)}GB / ${(mem.total / 1024 / 1024 / 1024).toFixed(1)}GB)`,
          uptime: formatUptime(process.uptime()),
          node: process.version,
        },
        agent: agentStatus,
        config: {
          stt: config.audio.sttProvider,
          maxIter: config.agent.maxIterations,
          memWindow: config.agent.memoryWindowSize,
        },
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Logs endpoint
  app.get('/api/logs', auth, (_req: Request, res: Response) => {
    res.json({ logs: [...logBuffer] });
  });

  // Clear logs
  app.get('/api/clear-logs', auth, (_req: Request, res: Response) => {
    logBuffer.length = 0;
    res.json({ ok: true });
  });

  // Reload skills
  app.get('/api/reload-skills', auth, (_req: Request, res: Response) => {
    controller.reloadSkills();
    captureLog('info', 'Skills reloaded via admin panel');
    res.json({ ok: true });
  });

  // Serve index for all other routes
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

export function startAdminServer(controller: AgentController): void {
  if (!config.admin.enabled) {
    logger.info('Admin panel disabled');
    return;
  }

  const app = createAdminServer(controller);
  app.listen(config.admin.port, config.admin.host, () => {
    logger.info(`Admin panel running at http://${config.admin.host}:${config.admin.port}`);
    captureLog('info', `Admin panel started on port ${config.admin.port}`);
  });
}
