import { Hono } from 'hono';
import { piflowChatRoutes } from './chat.js';
import { piflowSessionRoutes } from './sessions.js';
import { piflowSkillRoutes } from './skills.js';

export const piflowRoutes = new Hono();

piflowRoutes.route('/chat', piflowChatRoutes);
piflowRoutes.route('/sessions', piflowSessionRoutes);
piflowRoutes.route('/skills', piflowSkillRoutes);
