import hljs from 'highlight.js/lib/core'
import julia from 'highlight.js/lib/languages/julia'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import scala from 'highlight.js/lib/languages/scala'
import sql from 'highlight.js/lib/languages/sql'

hljs.registerLanguage('python', python)
hljs.registerLanguage('r', r)
hljs.registerLanguage('julia', julia)
hljs.registerLanguage('scala', scala)
hljs.registerLanguage('sql', sql)

const ALIASES: Record<string, string> = { ipython: 'python', py: 'python', python3: 'python', ipython3: 'python' }

/** Fills an element with highlighted code; unknown languages stay plain text. */
export function highlightInto(target: HTMLElement, source: string, language: string | undefined): void {
  const key = (language ?? '').toLowerCase()
  const name = ALIASES[key] ?? key
  if (name && hljs.getLanguage(name)) {
    target.innerHTML = hljs.highlight(source, { language: name, ignoreIllegals: true }).value
    target.classList.add('hljs')
  } else {
    target.textContent = source
  }
}
