/** The panel's own inline icons: no icon font, no external file. They inherit
 * the current text colour, so they are right in every theme and accent. */

function Svg({ children, label }: { children: unknown[]; label?: string }) {
  return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" {...(label ? { ariaLabel: label } : {})}>
    {children}
  </svg>
}

/** An open folder: the "Open notebook" button. */
export function IconOpen() {
  return <Svg>
    <path d="M2 3.5h4l1.2 1.5H14v7.5H2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
    <path d="M2 9h12" stroke="currentColor" stroke-width="1.5" />
  </Svg>
}

/** A chevron pointing up: the previous search result. */
export function IconUp() {
  return <Svg><path d="M3.5 10 8 5.5 12.5 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></Svg>
}

/** A chevron pointing down: the next search result. */
export function IconDown() {
  return <Svg><path d="M3.5 6 8 10.5 12.5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></Svg>
}

/** A list of headings: the outline. */
export function IconList() {
  return <Svg>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    <path d="M2.5 3.5h1.6v1.6H2.5zM2.5 7.4h1.6v1.6H2.5zM2.5 11.3h1.6v1.6H2.5z" fill="currentColor" />
  </Svg>
}

/** Two chevrons collapsed into one: fold everything. */
export function IconFold() {
  return <Svg><path d="M4 6.2 8 3l4 3.2M4 9.8 8 13l4-3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></Svg>
}

/** A screen with a bar under it: the outputs. */
export function IconOutputs() {
  return <Svg>
    <rect x="2" y="3" width="12" height="8" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5" />
    <path d="M5 13h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
  </Svg>
}

/** Three dots: the menu that holds the secondary controls on a narrow panel. */
export function IconMenu() {
  return <Svg><path d="M8 3.2v.01M8 8v.01M8 12.8v.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></Svg>
}

/** A question mark in a ring: the keyboard shortcuts list. */
export function IconHelp() {
  return <Svg>
    <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4" />
    <path d="M6.2 6.4c.2-1.6 3.4-1.8 3.6-.1.1 1.1-1.8 1.4-1.8 2.7v.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    <path d="M8 12v.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
  </Svg>
}

/** A cross: close. */
export function IconClose() {
  return <Svg><path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></Svg>
}
