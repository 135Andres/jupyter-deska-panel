export type Locale = 'en' | 'es'

const WORDS = {
  en: {
    title: 'Notebook Viewer',
    unsupported: 'Unsupported notebook file',
    open: 'Open notebook',
    drop: 'Drop a .ipynb file here or choose one.',
    cancel: 'Cancel',
    anyway: 'Open anyway',
    large: 'This notebook is large and may take a while to open.',
    size: 'It will not be saved for next time because it is over 32 MB.',
    changed: 'Changed',
    all: 'All',
    foldAll: 'Fold all',
    unfoldAll: 'Unfold all',
    outputsOnly: 'Outputs only',
    saveError: 'The last notebook could not be saved for next time.',

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
    title: 'Notebook Viewer',
    unsupported: 'Archivo de notebook no compatible',
    open: 'Abrir notebook',
    drop: 'Arrastra un archivo .ipynb aquí o selecciónalo.',
    cancel: 'Cancelar',
    anyway: 'Abrir de todos modos',
    large: 'Este notebook es grande y puede tardar en abrirse.',
    size: 'No se guardará para la próxima sesión porque supera 32 MB.',
    changed: 'Cambiadas',
    all: 'Todas',
    foldAll: 'Plegar todo',
    unfoldAll: 'Desplegar todo',
    outputsOnly: 'Solo salidas',
    saveError: 'No se pudo guardar el último notebook para la próxima sesión.',

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
