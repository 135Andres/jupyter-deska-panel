import { describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { Navigation } from './Navigation'
import type { Cell, Notebook } from '../model'

const cell = (id: string, type: Cell['type'], source: string): Cell => ({ id, type, source, outputs: [] })
const notebook: Notebook = {
  cells: [cell('m', 'markdown', '# Title'), cell('a', 'code', 'needle'), cell('b', 'code', 'other')],
  metadata: {},
  format: { adapterId: 'jupyter', version: '4.5' },
}

describe('Navigation', () => {
  it('waits to index while paused and catches up when shown again', async () => {
    const host = document.createElement('div')
    render(<Navigation notebook={notebook} locale="en" paused navigate={() => {}} />, host)

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(host.textContent).toContain('Outline (0)')

    render(<Navigation notebook={notebook} locale="en" navigate={() => {}} />, host)
    await vi.waitFor(() => expect(host.textContent).toContain('Outline (1)'))
    expect(host.querySelector('.outline button')?.textContent).toBe('Title')
  })

  it('does not search while paused, and answers once shown', async () => {
    const host = document.createElement('div')
    render(<Navigation notebook={notebook} locale="en" navigate={() => {}} />, host)
    await vi.waitFor(() => expect(host.textContent).toContain('Outline (1)'))

    render(<Navigation notebook={notebook} locale="en" paused navigate={() => {}} />, host)
    const input = host.querySelector('input[type=search]') as HTMLInputElement
    input.value = 'needle'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(host.textContent).toContain('Searching…')
    expect(host.textContent).not.toContain('/ 1')

    render(<Navigation notebook={notebook} locale="en" navigate={() => {}} />, host)
    await vi.waitFor(() => expect(host.textContent).toContain('0 / 1'))
  })
})
