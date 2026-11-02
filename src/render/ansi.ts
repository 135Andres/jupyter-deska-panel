import { AnsiUp } from 'ansi_up'

/** Whether text carries ANSI colour codes. */
export function hasAnsi(text: string): boolean {
  return text.includes('\u001b[')
}

/** Fills an element with text, turning ANSI colours into theme-aware classes. */
export function ansiInto(target: HTMLElement, text: string): void {
  if (!hasAnsi(text)) {
    target.textContent = text
    return
  }
  const converter = new AnsiUp()
  converter.use_classes = true
  converter.escape_html = true
  // The converter escapes the text itself, so only its own <span> tags remain.
  target.innerHTML = converter.ansi_to_html(text)
}
