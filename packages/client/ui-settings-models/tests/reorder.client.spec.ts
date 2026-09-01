/** Unit behavior of the drag-reorder helpers shared by the provider list and both model editors. */
import { describe, expect, it } from 'vitest'
import {
  indexAfterMove, indexAfterRemove, insertIndexOf, movedRows, reindexRowState, rekeyEditingBuffers, rowHalfOf,
} from '../src/client/reorder.ts'

/** A drag event positioned against a fake row rect, as drag events carry it. */
function halfEvent(clientY: number, top: number, height: number): Parameters<typeof rowHalfOf>[0] {
  return {
    clientY,
    currentTarget: {
      getBoundingClientRect: () => ({
        top, height, bottom: top + height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}),
      }),
    },
  } as unknown as Parameters<typeof rowHalfOf>[0]
}

describe('rowHalfOf', () => {
  it('splits a row at its vertical midpoint', () => {
    expect(rowHalfOf(halfEvent(0, 100, 100))).toBe('before')
    expect(rowHalfOf(halfEvent(200, 100, 100))).toBe('after')
    expect(rowHalfOf(halfEvent(149, 100, 100))).toBe('before')
    expect(rowHalfOf(halfEvent(150, 100, 100))).toBe('after')
  })
})

describe('insertIndexOf', () => {
  it('inserts before the hovered row for its top half', () => {
    expect(insertIndexOf(0, { index: 2, half: 'before' })).toBe(1)
  })

  it('inserts before the successor for the bottom half', () => {
    expect(insertIndexOf(0, { index: 2, half: 'after' })).toBe(2)
  })

  it('inserts at the end for the bottom half of the last row', () => {
    expect(insertIndexOf(1, { index: 3, half: 'after' })).toBe(3)
  })

  it('maps both halves of the dragged row back to itself, the no-op', () => {
    expect(insertIndexOf(2, { index: 2, half: 'before' })).toBe(2)
    expect(insertIndexOf(2, { index: 2, half: 'after' })).toBe(2)
  })
})

describe('movedRows', () => {
  const rows = ['a', 'b', 'c', 'd']

  it('removes the dragged row then splices it in at the target', () => {
    expect(movedRows(rows, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(movedRows(rows, 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('leaves the order unchanged for a no-op move', () => {
    expect(movedRows(rows, 1, 1)).toEqual(rows)
  })

  it('copies the rows when the source index names no row', () => {
    expect(movedRows(rows, 5, 0)).toEqual(rows)
    expect(movedRows([], 0, 0)).toEqual([])
  })
})

describe('indexAfterMove', () => {
  it('moves the row to the target and shifts the rows it passes toward the source', () => {
    // forward: 0 moves to 2
    expect(indexAfterMove(0, 0, 2)).toBe(2)
    expect(indexAfterMove(1, 0, 2)).toBe(0)
    expect(indexAfterMove(2, 0, 2)).toBe(1)
    expect(indexAfterMove(3, 0, 2)).toBe(3)
    // backward: 2 moves to 0
    expect(indexAfterMove(0, 2, 0)).toBe(1)
    expect(indexAfterMove(1, 2, 0)).toBe(2)
    expect(indexAfterMove(2, 2, 0)).toBe(0)
    expect(indexAfterMove(3, 2, 0)).toBe(3)
  })
})

describe('indexAfterRemove', () => {
  it('shifts the rows after the deleted one down and drops the deleted one', () => {
    expect(indexAfterRemove(0, 1)).toBe(0)
    expect(indexAfterRemove(1, 1)).toBeUndefined()
    expect(indexAfterRemove(3, 1)).toBe(2)
  })
})

describe('rekeyEditingBuffers', () => {
  it('renumbers the buffers around a removal and drops the deleted row\'s own', () => {
    const editing = new Map([['0:contextWindow', '2M'], ['1:contextWindow', '1K'], ['2:maxTokens', '8K']])
    expect(rekeyEditingBuffers(editing, at => indexAfterRemove(at, 1)))
      .toEqual(new Map([['0:contextWindow', '2M'], ['1:maxTokens', '8K']]))
  })

  it('renumbers the buffers when a row moves', () => {
    const editing = new Map([['0:contextWindow', '2M'], ['1:maxTokens', '8K']])
    expect(rekeyEditingBuffers(editing, at => indexAfterMove(at, 0, 2)))
      .toEqual(new Map([['2:contextWindow', '2M'], ['0:maxTokens', '8K']]))
  })
})

describe('reindexRowState', () => {
  it('re-indexes per-row marks across a removal and a move', () => {
    expect(reindexRowState(new Set([0, 2, 3]), at => indexAfterRemove(at, 1)))
      .toEqual(new Set([0, 1, 2]))
    expect(reindexRowState(new Set([0, 2]), at => indexAfterMove(at, 0, 2)))
      .toEqual(new Set([2, 1]))
  })
})
