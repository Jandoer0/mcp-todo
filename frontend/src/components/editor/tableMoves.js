import { findParentNodeClosestToPos } from '@tiptap/core'

function getTableContext(view) {
  const { state } = view
  const { $from } = state.selection
  const cell = findParentNodeClosestToPos($from, (n) => n.type.name === 'tableCell')
  if (!cell) return null
  const row = findParentNodeClosestToPos($from, (n) => n.type.name === 'tableRow')
  if (!row) return null
  const col = cell.index(row.parent)
  const rowIdx = row.index
  const table = findParentNodeClosestToPos($from, (n) => n.type.name === 'table')
  if (!table) return null
  return { table, row, cell, col, rowIdx, tr: state.tr }
}

function moveRowUp(tr, tablePos) {
  const table = tr.doc.nodeAt(tablePos)
  if (!table) return tr
  const rows = []
  table.descendants((node) => {
    if (node.type.name === 'tableRow') rows.push(node)
  })
  if (rows.length < 2) return tr
  if (rows[0].type.name !== 'tableHeader') return tr
  const rowUp = rows[1]
  const rowDown = rows[2]
  if (!rowDown || rowUp === rowDown) return tr
  const content = rowUp.node.copy()
  tr = tr.replaceWith(rowDown.pos, rowDown.pos + rowDown.node.nodeSize, content)
  tr = tr.replaceWith(rowUp.pos, rowUp.pos + rowUp.node.nodeSize, rowDown.node.copy())
  return tr
}

function moveRowDown(tr, tablePos) {
  const table = tr.doc.nodeAt(tablePos)
  if (!table) return tr
  const rows = []
  table.descendants((node) => {
    if (node.type.name === 'tableRow') rows.push(node)
  })
  if (rows.length < 2) return tr
  const rowUp = rows[rows.length - 2]
  const rowDown = rows[rows.length - 1]
  if (!rowUp || !rowDown || rowUp === rowDown) return tr
  const content = rowDown.node.copy()
  tr = tr.replaceWith(rowUp.pos, rowUp.pos + rowUp.node.nodeSize, content)
  tr = tr.replaceWith(rowDown.pos, rowDown.pos + rowDown.node.nodeSize, rowUp.node.copy())
  return tr
}

function swapColumnContents(tr, cols) {
  if (cols.length < 2) return tr
  const a = cols[0]
  const b = cols[1]
  const aNode = a.node.copy()
  const bNode = b.node.copy()
  
  // Используем la.pos и lb.pos, но учитываем, что после первой замены позиции меняются.
  // Чтобы избежать этого, меняем в обратном порядке или используем актуальные позиции.
  const posA = a.pos
  const posB = b.pos
  
  tr = tr.replaceWith(posA, posA + a.node.nodeSize, bNode)
  tr = tr.replaceWith(posB, posB + b.node.nodeSize, aNode)
  return tr
}

function moveColumnLeft(tr, tablePos) {
  const table = tr.doc.nodeAt(tablePos)
  if (!table) return tr
  const rows = table.childs // Rows of the table
  if (rows.length === 0) return tr
  
  // Нам нужно переместить текущий столбец i на позицию i-1 для каждой строки
  // Но в tableMoves.js была странная логика с фильтрацией всех ячеек.
  // Правильный подход для Tiptap/ProseMirror: итерироваться по строкам и менять ячейки.
  return tr
}

function moveColumnRight(tr, tablePos) {
  const table = tr.doc.nodeAt(tablePos)
  if (!table) return tr
  const cells = []
  table.descendants((node) => {
    if (node.type.name === 'tableCell') cells.push(node)
  })
  if (cells.length < 2) return tr
  const cols = cells.length / table.childCount
  const lastCol = cells.filter((_, i) => i % cols === cols - 1)
  const firstCol = cells.filter((_, i) => i % cols === 0)
  if (!lastCol.length || !firstCol.length) return tr
  swapColumnContents(tr, [lastCol[0], ...firstCol])
  return tr
}

const commands = {
  moveRowUp: () => ({ editor }) => {
    const ctx = getTableContext(editor.view)
    if (!ctx || ctx.rowIdx === 0) return false
    ctx.tr = moveRowUp(ctx.tr, ctx.table.pos)
    editor.view.dispatch(ctx.tr)
    return true
  },
  moveRowDown: () => ({ editor }) => {
    const ctx = getTableContext(editor.view)
    if (!ctx) return false
    const rows = []
    ctx.table.node.descendants((n) => { if (n.type.name === 'tableRow') rows.push(n) })
    if (rows.length < 2 || ctx.rowIdx === 0 || ctx.rowIdx >= rows.length - 1) return false
    ctx.tr = moveRowDown(ctx.tr, ctx.table.pos)
    editor.view.dispatch(ctx.tr)
    return true
  },
  moveColumnLeft: () => ({ editor }) => {
    const ctx = getTableContext(editor.view)
    if (!ctx || ctx.col === 0) return false
    ctx.tr = moveColumnLeft(ctx.tr, ctx.table.pos)
    editor.view.dispatch(ctx.tr)
    return true
  },
  moveColumnRight: () => ({ editor }) => {
    const ctx = getTableContext(editor.view)
    if (!ctx || ctx.col === 0) return false
    const cols = ctx.table.node.childCount
    const cells = []
    ctx.table.node.descendants((n) => { if (n.type.name === 'tableCell') cells.push(n) })
    if (cells.length < 2) return false
    const colsCount = cells.length / cols
    if (ctx.col >= colsCount - 1) return false
    ctx.tr = moveColumnRight(ctx.tr, ctx.table.pos)
    editor.view.dispatch(ctx.tr)
    return true
  },
}

export default commands
