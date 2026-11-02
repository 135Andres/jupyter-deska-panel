export type Locale = 'en' | 'es'

const WORDS = {
  en: {
    interactive: 'Interactive output, not shown',
    rawCell: 'Raw cell',
    stderr: 'stderr',
    foldInput: 'Input',
    foldOutput: 'Output',
    hiddenOutputs: 'Output hidden',
  },
  es: {
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
