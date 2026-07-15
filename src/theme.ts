import { SyntaxStyle } from "@opentui/core"

// Советская тема: красное знамя + золото серпа и молота.
// Тело текста НЕ красим — берём цвет темы терминала (адаптив light/dark).
export const theme = {
  accent: "#e4181c", // знамённый красный: рамки, эмблема, фокус
  accentDim: "#a01015",
  gold: "#ffd700", // золото: заголовки, звёзды, статусы
  muted: "#8a8f98", // метаданные, подсказки
  user: "#c9d1d9", // реплики пользователя — чуть тусклее тела
  success: "#3fb950",
  error: "#f85149",
  warning: "#d29922",
  info: "#539bf5",
} as const

// ASCII-безопасные глифы (1 ячейка в большинстве терминалов).
export const glyph = {
  user: "›",
  agent: "★",
  branch: "└",
  pending: "⋯",
  ok: "✓",
  fail: "✗",
  arrow: "→",
  star: "★",
  hammerSickle: "☭",
} as const

// Пиксель-арт «серп и молот» (сгенерирован геометрически, полублоки для сглаживания).
export const emblemArt = [
  "      ▄█▄  ▄▄▄▄",
  "   ▄▄█████   ▀▀██▄",
  "  ▀███████      ███",
  "    ██▀███▄      ███",
  "        ▀███▄    ███",
  "          ████  ▄███",
  "           ▀███████",
  "        ▄█▄███████",
  "       ▄███▀▀▀▀████",
  "      ▄███     ▀▀▀▀",
] as const

// «CCCP» латиницей блочным шрифтом (читается как кириллица, рендерится везде).
export const wordmarkArt = [
  "▄████  ▄████  ▄████  █████▄",
  "██     ██     ██     ██  ██",
  "██     ██     ██     █████▀",
  "██     ██     ██     ██",
  "▀████  ▀████  ▀████  ██",
] as const

export const emblemMotto = "Народный комиссариат программирования"
export const agentName = "Наркомпрог"

// Кадры спиннера (Braille — узкие, не ambiguous по ширине).
export const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

// Стиль подсветки для <code>. Ключи — Tree-sitter / markup.
export function syntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: {},
    "markup.heading": { fg: theme.gold, bold: true },
    "markup.bold": { bold: true },
    "markup.italic": { italic: true },
    "markup.link": { fg: theme.info, underline: true },
    "markup.list": { fg: theme.accent },
    "markup.quote": { fg: theme.muted, italic: true },
    "markup.raw": { fg: theme.gold },
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
    "diff.plus": { fg: theme.success },
    "diff.minus": { fg: theme.error },
  })
}
