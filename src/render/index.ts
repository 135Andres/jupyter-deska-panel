import type { Notebook } from '../model/types'

/** Theme and language used to render a notebook. */
export interface MountOptions {
  theme: 'light' | 'dark'
  locale: 'en' | 'es'
}

/** A mounted notebook that can be updated, navigated, and destroyed. */
export interface NotebookView {
  update(notebook: Notebook): void
  scrollToCell(id: string): void
  destroy(): void
}

/** Mounts a notebook into a container. */
export function mountNotebook(
  container: HTMLElement,
  notebook: Notebook,
  options: MountOptions,
): NotebookView {
  void container
  void notebook
  void options
  throw new Error('not implemented')
}
