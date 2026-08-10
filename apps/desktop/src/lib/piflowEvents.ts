export const PIFLOW_SKILLS_CHANGED_EVENT = 'piflow-skills-changed';

/** Dispatch after KB import / skill settings save so UI refreshes ready state. */
export function notifyPiFlowSkillsChanged(): void {
  window.dispatchEvent(new Event(PIFLOW_SKILLS_CHANGED_EVENT));
}
