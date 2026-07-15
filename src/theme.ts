import { SyntaxStyle } from "@opentui/core"

// Советская тема: красное знамя + золото серпа и молота.
// Тело текста НЕ красим — берём цвет темы терминала (адаптив light/dark).
export const theme = {
  accent: "#e4181c", // знамённый красный: рамки, имя агента, фокус
  accentDim: "#a01015",
  gold: "#ffd700", // золото серпа и молота, звёзды, заголовки
  muted: "#8a8f98", // метаданные, префикс пользователя, подсказки
  user: "#c9d1d9", // реплики пользователя — чуть тусклее тела
  success: "#3fb950",
  error: "#f85149",
  warning: "#d29922",
  info: "#539bf5",
} as const

// ASCII-безопасные глифы (1 ячейка в большинстве терминалов).
export const glyph = {
  user: "›",
  agent: "★", // красная звезда вместо буллета — по теме
  branch: "└",
  pending: "⋯",
  ok: "✓",
  fail: "✗",
  arrow: "→",
  star: "★",
  hammerSickle: "☭",
} as const

// Эмблема-шапка. Каждая строка рендерится отдельным <text> и стабильно
// стекается в колонку (в отличие от многострочного <ascii-font>, который
// ломал layout). Разрядка-капитель — советский плакатный стиль, кириллица
// рендерится везде, в отличие от figlet-шрифтов.
export const emblemStar = "★  ☭  С О Ю З   С С Р  ☭  ★"
export const emblemWordmark = "З А Р Е К А"
export const emblemMotto = "Рабоче-крестьянский кодинг-агент"

// Кадры спиннера (Braille — узкие, не ambiguous по ширине).
export const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

// Стиль подсветки для <markdown> и <code>. Ключи — Tree-sitter / markup.
export function syntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: {},
    "markup.heading": { fg: theme.gold, bold: true },
    "markup.heading.1": { fg: theme.gold, bold: true },
    "markup.heading.2": { fg: theme.gold, bold: true },
    "markup.bold": { bold: true },
    "markup.italic": { italic: true },
    "markup.link": { fg: theme.info, underline: true },
    "markup.link.url": { fg: theme.info, underline: true },
    "markup.list": { fg: theme.accent },
    "markup.quote": { fg: theme.muted, italic: true },
    "markup.raw": { fg: theme.gold },
    "markup.raw.inline": { fg: theme.gold },
    // код
    keyword: { fg: "#ff7b72", bold: true },
    string: { fg: "#a5d6ff" },
    comment: { fg: theme.muted, italic: true },
    function: { fg: "#d2a8ff" },
    "function.method": { fg: "#d2a8ff" },
    type: { fg: "#79c0ff" },
    number: { fg: "#79c0ff" },
    constant: { fg: "#79c0ff" },
    variable: {},
    property: { fg: "#79c0ff" },
    operator: { fg: "#ff7b72" },
    punctuation: { fg: theme.muted },
    // дифф
    "diff.plus": { fg: theme.success },
    "diff.minus": { fg: theme.error },
  })
}
