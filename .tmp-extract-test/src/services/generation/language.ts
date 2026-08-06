/** 检测问题是否以中文为主（含 CJK 字符） */
export function isChineseQuery(text: string): boolean {
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  if (!cjk) return false;
  return cjk.length >= Math.max(2, text.replace(/\s/g, '').length * 0.2);
}

export function isPleiasModelName(model: string): boolean {
  return model.toLowerCase().includes('pleias');
}
