export type Locale = 'en' | 'es'

const WORDS = {
  en: {
    navigation: 'Notebook navigation',
    outline: 'Outline',
    search: 'Search cells',
    previous: 'Previous',
    next: 'Next',
    searching: 'Searching…',
    interactive: 'Interactive output, not shown',
    rawCell: 'Raw cell',
    stderr: 'stderr',
    foldInput: 'Input',
    foldOutput: 'Output',
    hiddenOutputs: 'Output hidden',
  },
  es: {
    navigation: 'Navegación del notebook',
    outline: 'Índice',
    search: 'Buscar en celdas',
    previous: 'Anterior',
    next: 'Siguiente',
    searching: 'Buscando…',
    interactive: 'Salida interactiva, no se muestra',
    rawCell: 'Celda sin formato',
    stderr: 'stderr',
    foldInput: 'Entrada',
    foldOutput: 'Salida',
    hiddenOutputs: 'Salida plegada',
  },
} as const

export type WordKey = keyof (typeof WORDS)['en']

/** The panel's own words in the given locale. */
export function t(locale: Locale, key: WordKey): string {
  return WORDS[locale][key]
}
