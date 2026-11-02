/** Vrai si la touche doit aller au champ de saisie plutôt qu'aux raccourcis. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['range', 'checkbox', 'radio', 'button', 'submit', 'file'].includes(type);
  }
  return false;
}
