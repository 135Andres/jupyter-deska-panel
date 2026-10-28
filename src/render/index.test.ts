import { expect, expectTypeOf, test } from 'vitest'
import type { Notebook } from '../model/types'
import { mountNotebook } from './index'
import type { MountOptions, NotebookView } from './index'

test('exports the notebook mounting API', () => {
  expect(mountNotebook).toBeTypeOf('function')
  expectTypeOf(mountNotebook).toEqualTypeOf<
    (container: HTMLElement, notebook: Notebook, options: MountOptions) => NotebookView
  >()
})
