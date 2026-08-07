import { Hono } from 'hono';
import {
  getSkillSettings,
  listSkillInfos,
  saveSkillSettings,
  type PiFlowSkillSettings,
} from '../../services/piflow/skill-settings.js';

export const piflowSkillRoutes = new Hono();

piflowSkillRoutes.get('/', (c) => {
  return c.json({
    skills: listSkillInfos(),
    settings: getSkillSettings(),
  });
});

piflowSkillRoutes.put('/settings', async (c) => {
  let body: Partial<PiFlowSkillSettings>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const saved = saveSkillSettings(body);
    return c.json({
      ok: true,
      settings: saved,
      skills: listSkillInfos(),
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});
