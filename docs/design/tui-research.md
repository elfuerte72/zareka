# Дизайн TUI: исследование для Зареки

> Справочный документ. Собран из первоисточников (Claude Code, OpenAI Codex, opencode,
> charmbracelet/crush, Gemini CLI, aider, документация OpenTUI, спецификации Unicode).
> Цель — база для редизайна интерфейса Зареки. Ссылки на источники — в конце каждого раздела.

## 0. Как вообще работает терминальное приложение

TUI — это процесс, который договаривается с терминалом через escape-последовательности ANSI:

- **Raw mode** — терминал отдаёт каждое нажатие сразу в stdin, не буферизуя построчно и не
  перехватывая Ctrl+C.
- **Alternate screen buffer** — «второй экран» (как у vim/less), чтобы не мусорить в истории.
  Тренд 2026: кодинг-агенты часто **отказываются** от него ради дифференциального рендера в
  обычный scrollback — так сохраняются нативные выделение, прокрутка и поиск (Cmd+F).
- **Событийный цикл** — слушает stdin (клавиши), таймеры и сеть (у нас — SSE от `opencode serve`).
- **Диффинг рендера** — сравнивается новый кадр с предыдущим, в терминал пишутся escape-коды
  только для изменившихся ячеек. У OpenTUI этим занимается нативное Zig-ядро.
- **SIGWINCH** — сигнал об изменении размера окна; приложение перекомпоновывает layout.
- **Гигиена**: panic-safe восстановление терминала при падении, уважение `NO_COLOR`, `TERM=dumb`,
  проверка `isatty` (не TTY → без цвета).

---

## 1. Принципы визуального дизайна терминала

Сквозной принцип всех современных руководств — **изящная деградация (graceful degradation)**:
дизайн строится на фундаменте из 16 ANSI-цветов и чистого ASCII, а truecolor, Nerd Fonts и
эмодзи — улучшения поверх, которые усиливают иерархию, но никогда её не создают. Если интерфейс
разваливается без truecolor или без патченного шрифта — он спроектирован неверно.

### 1.1 Цвет

Escape-коды (SGR, `\e` = ESC = `\x1b`):

| Режим | Foreground | Background |
|---|---|---|
| 16 ANSI (базовые) | `\e[30m`…`\e[37m` | `\e[40m`…`\e[47m` |
| 16 ANSI (яркие) | `\e[90m`…`\e[97m` | `\e[100m`…`\e[107m` |
| 256 | `\e[38;5;Nm` | `\e[48;5;Nm` |
| Truecolor 24-bit | `\e[38;2;R;G;Bm` | `\e[48;2;R;G;Bm` |
| Сброс | `\e[0m` | |

- **16 ANSI — обязательный фундамент.** Их конкретный RGB задаёт *тема пользователя*, поэтому
  опора на индексы 0–15 «бесплатно» подстраивается под светлую/тёмную тему терминала.
- **256:** индексы 0–15 = ANSI, 16–231 = куб 6×6×6, 232–255 = 24 ступени серого (удобно для
  уровней «приглушённости»).
- **Truecolor:** детект через переменную `COLORTERM` (`truecolor`/`24bit`). Не хардкодить фон —
  конфликтует с темой пользователя.
- **Детект фона (light/dark) в рантайме** — OSC 11: пишем `\e]11;?\e\\`, терминал отвечает
  цветом фона; считаем luminance → классифицируем. Fallback — `$COLORFGBG`.
- **Семантические роли, а не оттенки:** `fg.default` / `fg.muted` / `fg.emphasis`,
  `bg.base` / `bg.surface` / `bg.overlay`, `accent.primary` (только интерактив/фокус),
  `status.success|warning|error|info`.
- **Рецепт иерархии:** ~80% текста — `fg.default`; заголовки — bold + `fg.emphasis`;
  метаданные — dim + `fg.muted`; акцент — только для интерактивного.
- **Доступность:** контраст 4.5:1 для текста, 3:1 для UI; никогда не полагаться только на цвет
  (дублировать символом/текстом); избегать пар red/green для дальтоников (лучше blue+orange).
  Уважать `NO_COLOR`, `--no-color`, не-TTY.

### 1.2 Иерархия при одном моноширинном шрифте

Размер шрифта менять нельзя — иерархию создают начертание, яркость, цвет, пространство, символы:

| Приём | Код | Роль |
|---|---|---|
| Bold | `\e[1m` | заголовки, метки, активный элемент |
| Dim/faint | `\e[2m` | метаданные, таймстемпы |
| Italic | `\e[3m` | комментарии, типы (не везде поддержан) |
| Underline | `\e[4m` | ссылки, actionable |
| Reverse | `\e[7m` | выделение строки/курсор |

Уровни без смены кегля: **bold+заглавные+акцент** (заголовки) → обычный (тело) →
**dim/muted** (второстепенное) → **отступ** (вложенность, 2–4 пробела/уровень) →
**box-drawing** (границы зон) → **слои фона** (глубина). Пара `dim + bold` — самая безопасная,
работает даже в 16-цветном режиме.

### 1.3 Псевдографика и рамки

- **Single** `─ │ ┌ ┐ └ ┘` — минимализм, техничность; дефолт для таблиц/кода.
- **Rounded** `╭ ╮ ╰ ╯` — дружелюбный, современный; де-факто стандарт свежих CLI/TUI.
- **Double** `═ ║ ╔ ╗` — формальный, для важных уведомлений.
- **Heavy** `━ ┃ ┏ ┓` — командует вниманием, для акцентной панели.

Правило: не смешивать больше двух весов на экране; толстое — главному, тонкое — подчинённому.
**Сначала разделять пространством и слоями фона, рамку добавлять только там, где нужна явная
демаркация фокуса.** Для деревьев — гайды `├── └── │`. Блоки данных: `█▉▊▋▌▍▎▏` (8 суб-ячеечных
шагов, прогресс), `░▒▓` (тени/heatmap), `▁▂▃▄▅▆▇█` (спарклайны), Braille `⠁…⣿` (графики).

### 1.4 Отступы и вертикальный ритм

Единица измерения — **символьная ячейка**. Аналог 8-pt сетки:
- Горизонталь — шкала кратная **2 / 4 / 8** символов; внутренний паддинг панели ≈ 1–2 ячейки.
- Вертикаль — единица **1 строка**; типовое: 1 пустая строка внутри секции, 2 — между секциями.
- **Глубина без рамок:** слои фона `bg.base → bg.surface → bg.overlay`, шаг ≈5–8% светлоты на
  слой в тёмной теме — «панели» и модалки без шума линий.

### 1.5 Иконки

| Вариант | Ширина | Совместимость | Когда |
|---|---|---|---|
| ASCII (`*`, `>`, `[x]`) | 1 ячейка, гарантированно | 100% | fallback, обязателен |
| Unicode (`✔ ✖ ⚠ • → ●`) | опасно (часть — Ambiguous) | широкая | семантика, с проверкой ширины |
| Nerd Fonts **Mono** | ровно 1 ячейка | нужен патченный шрифт | dev-инструменты |
| Эмодзи | **2 ячейки** | почти везде, метрики скачут | акцент, не для выравнивания |

**Для русскоязычного приложения:** кириллица (U+0400–04FF) — Neutral = **1 ячейка**, выравнивание
не ломает; настоящий риск — покрытие шрифта (проверять кириллицу в JetBrains Mono/Fira Code/
Cascadia/IBM Plex Mono). Эмодзи в таблицах/списках с кириллицей опасны из-за двойной ширины.
**Рекомендованный стек: ASCII-fallback → single-width Unicode (`•`, `→`, `✓`/`×` с проверкой
ширины) → Nerd Fonts Mono/эмодзи опционально при детекте.**

Источники: [jvns — terminal colours](https://jvns.ca/blog/2024/10/01/terminal-colours/) ·
[termstandard/colors](https://github.com/termstandard/colors) · [clig.dev](https://clig.dev/) ·
[UAX #11 East Asian Width](https://www.unicode.org/reports/tr11/) ·
[wcwidth (mgk25)](https://www.cl.cam.ac.uk/~mgk25/ucs/wcwidth.c) ·
[Nerd Fonts FAQ](https://github.com/ryanoasis/nerd-fonts/wiki/FAQ-and-Troubleshooting) ·
[Textual — border styles](https://textual.textualize.io/styles/border/) ·
[OSC 11 fg/bg](https://jwodder.github.io/kbits/posts/term-fgbg/)

---

## 2. Паттерны эталонных кодинг-агентов

Технологический расклад: **Ink** (React, Yoga-flexbox) → Claude Code, Gemini CLI;
**Bubble Tea + Lipgloss + Glamour** (Go, Elm) → opencode, crush, экосистема Charm;
**Ratatui** (Rust) → Codex; **prompt_toolkit + Rich** (Python) → aider.

**8 паттернов, повторяющихся у лучших:**

1. **Одна вертикальная колонка-транскрипт по умолчанию; панели опциональны.** Claude Code, Codex,
   opencode, crush-compact, aider — чат во всю ширину. Sidebar (файлы/LSP/MCP/контекст) —
   сворачиваемый оверлей по хоткею (`Ctrl+D` в crush, `tui.json` в opencode), не постоянная
   колонка. Мульти-панель остаётся у инспекторов состояния (lazygit, k9s).
2. **Стриминг через «активную ячейку» + покадровый diff буфера.** История статична,
   дорисовывается только хвост (`active_cell` у Codex, LogUpdate у Ink/Claude Code). Убирает
   мерцание и полную перерисовку длинных лент.
3. **Вызов инструмента = свёрнутый блок с лид-глифом и ветвью-результатом.** `⏺` + `⎿` (Claude
   Code), `●` pending (crush). Статус — семантическая иконка: `✓` успех, спиннер = в работе,
   `E`/красный = ошибка.
4. **Диффы: зелёный add / красный remove, unified по умолчанию + опциональный split, с
   нумерацией и подсветкой.** Фоны add/removed либо семантические (`#2b3312`/`#341212` в Gemini),
   либо захардкожены (Codex). Тренд 2026 — word-level подсветка изменений.
5. **Семантическое theming + много встроенных тем + живой пикер `/theme`.** Цвета = роли
   (`accent/ink/surface`, `error/warning/success`), адаптив light/dark. Отдельный приём — ремап
   16 ANSI-цветов shell-вывода на палитру темы (crush).
6. **Палитра слэш-команд с fuzzy-автодополнением + режимы-префиксы.** `/` — команды (часто с
   инлайн-аргументами: `/review`, `/plan`), `@` — файлы, `!` — bash; общая палитра `Ctrl+P`.
7. **Постоянный status-footer/header + спиннер «думаю» с прерыванием.** Внизу: модель, контекст/
   токены, cwd/ветка, подсказки клавиш. Спиннер + всегда `esc to interrupt`.
8. **Скруглённые/тонкие рамки + сдержанные глифы с ASCII-фолбэком + богатый markdown.** Доминирует
   `RoundedBorder` и тонкие `│`-разделители, воздух. Проза — полноценным markdown-движком
   (Glamour/Rich) с подсветкой кода.

Бонус: **всё диалоговое — модальные оверлеи поверх чата**, а не новые экраны (разрешения, выбор
модели, сессии).

Источники: [Claude Code TUI](https://deepwiki.com/flyboyer/claude-code/8-terminal-ui-(tui)-architecture) ·
[opencode TUI](https://opencode.ai/docs/tui/) ·
[Codex TUI](https://deepwiki.com/openai/codex/4.1-terminal-user-interface-(tui)) ·
[Gemini CLI themes](https://geminicli.com/docs/cli/themes/) ·
[aider](https://aider.chat/docs/config/options.html) ·
[crush](https://github.com/charmbracelet/crush) ·
[Lipgloss](https://github.com/charmbracelet/lipgloss) ·
[gum](https://github.com/charmbracelet/gum)

---

## 3. UX-паттерны чата кодинг-агента

- **Транскрипт и границы реплик.** Левый gutter с глифом-префиксом + цвет (не горизонтальные
  линейки): пользователь — `>` тускло-серым; ассистент и события инструментов — цветной bullet
  `●`; содержимое выровнено по gutter, многострочное «висит» под маркером. Вывод инструментов
  урезается до 3–4 строк → `+N lines (ctrl+o to expand)`.
- **Стриминг без мерцания.** Корень мерцания: у терминала нет атомарного кадра. Приём —
  **синхронизированный вывод DEC mode 2026**: обернуть перерисовку в `ESC[?2026h … ESC[?2026l`.
  Троттлинг токенов: буфер между источником и виджетом, рендер пачкой, дисплей «на пару мс»
  позади данных. Каретку набора обычно не имитируют — активность несёт спиннер.
- **Вызовы инструментов и диффы.** Однострочная сводка (имя + аргумент), разворот `Ctrl+O`.
  Диффы — unified/красно-зелёный/номера/подсветка, тумблер в split по ширине (`diff_style: auto`
  в opencode адаптируется к ширине). Продвинутое: список файлов слева, дифф справа, `Tab` между
  панелями, vim-навигация, инлайн-комментарии → скармливаются агенту.
- **Markdown при стриминге (критичный нюанс).** Документ бьётся на top-level блоки; при дозаписи
  меняется только последний, предыдущие «замораживаются». Незакрытые маркеры (открытый code
  fence) чинятся на лету, чтобы каждый кадр был валидным CommonMark. Подсветку кода накладывают
  фоновым воркером по завершении блока (сначала plain-text — нулевая воспринимаемая задержка).
- **«Думаю» / прогресс.** Спиннер + растущий таймбер + счётчик токенов; по ним же отличают
  «думает» от «завис» (стоят → завис). Claude Code: ~187 «глаголов»-состояний, настраиваемых.
- **Поле ввода.** `Enter` — отправка, `Ctrl+J` — перенос; `$EDITOR` для длинного; `Ctrl+R` —
  поиск по истории. `/` первым символом автоматически открывает автокомплит команд; часто один
  компонент обслуживает и `/`, и `@` (fuzzy-поиск файлов, содержимое инъектируется в сообщение).
- **Модалки.** Разрешение — инлайн в потоке (не отдельное окно): `y` — один раз, `s`/always — на
  сессию, `n` — отклонить, `r` — отклонить с причиной; матчинг по wildcard к имени тула;
  индикатор `auto` при авто-аппруве. Выбор модели — `/model`/`Ctrl+M`, пикер-список.

Источники: [CLAUDE_CODE_NO_FLICKER](https://slyapustin.com/blog/claude-code-no-flicker.html) ·
[DECSET 2026 в tmux (баг)](https://github.com/anthropics/claude-code/issues/37283) ·
[Streaming Markdown — McGugan](https://willmcgugan.github.io/streaming-markdown/) ·
[Glamour](https://github.com/charmbracelet/glamour) ·
[revdiff](https://revdiff.com/) ·
[opencode permissions](https://opencode.ai/docs/permissions/)

---

## 4. Возможности OpenTUI (что нам реально доступно)

**Markdown и подсветка — встроены в `@opentui/core`, внешние пакеты не нужны:**
- `MarkdownRenderable` — заголовки, списки, bold/italic, inline-code, fenced-блоки, таблицы.
  Опции `streaming` (инкрементальные апдейты — под стрим LLM), `conceal`, `renderNode`. Стиль —
  `SyntaxStyle.fromStyles()` (токен-ключи `markup.heading.1` и т.п.).
- `CodeRenderable` / `Code` — подсветка через **Tree-sitter**, пропсы `filetype`, `content`,
  `syntaxStyle`, `streaming`. Готовых тем нет — свой `SyntaxStyle`.
  Внимание: исторические регрессии рендера по версиям → фиксировать версию `@opentui/core`.

**Оформление текста:** `bold/dim/italic/underline/strikethrough/reverse` + `fg(hex)`/`bg(hex)` как
хелперы; шаблонный литерал `` t`...` `` собирает **StyledText**; в React — `<strong>`, `<u>`,
`<span fg>`. Градиент-API нет (эмулируется посимвольными спанами или слоями `ASCIIFont`).

**Компоненты:**

| Нужно | Есть | Имя |
|---|---|---|
| Скролл-контейнер | Да | `ScrollBoxRenderable` — `stickyScroll`+`stickyStart:"bottom"` (авто-follow чата), `viewportCulling`, `scrollbarOptions` |
| Однострочный ввод | Да | `InputRenderable` — события `INPUT`/`CHANGE`/`ENTER` |
| Многострочный ввод | Да | `TextareaRenderable` |
| Select/list | Да | `SelectRenderable` — `options[{name,description,value}]`, событие `ITEM_SELECTED` |
| Табы | Да | `TabSelectRenderable` |
| Крупный ASCII-текст | Да | `ASCIIFontRenderable` — шрифты `tiny/block/slick/shade` |
| Прогресс-бар | Нет | `SliderRenderable` или анимация `width` у `Box` |
| Спиннер | Нет в core | Анимировать `TextRenderable`; спиннеры есть в `@opentui-ui/toast` |
| Диалоги/модалки | Да (opentui-ui) | `@opentui-ui/dialog`: `confirm()→Promise<boolean>`, `choice<T>()`, стек, `useDialogKeyboard` |
| Тосты | Да (opentui-ui) | `@opentui-ui/toast`: `toast.success/error/loading` |

**Рамки/фокус/тема:** `borderStyle: single|double|rounded|heavy`, `borderColor`; `title` +
`titleColor` + `titleAlignment`, есть `bottomTitle`. Фокус — `.focus()`, `focusedBorderColor`/
`focusedBackgroundColor`. Глобальная тема — `renderer.setBackgroundColor()` (OSC 11),
`renderer.getPalette({size:16|256})` + слушатель смены темы терминала → динамическая ре-темизация.

### Таблица соответствия элементов Зареки

| Элемент | Компонент/API OpenTUI |
|---|---|
| Шапка-сплэш | `ASCIIFontRenderable` (`tiny/block`) в `Box` с `title` |
| Транскрипт | `ScrollBoxRenderable` (`stickyScroll`, `stickyStart:"bottom"`, `viewportCulling`); дети — `Box`-карточки с `MarkdownRenderable`(`streaming:true`) |
| Карточка вызова инструмента | `Box` (`border`+`title`+`borderColor`) + StyledText-статус + `CodeRenderable` для вывода |
| Просмотр диффа | `CodeRenderable`(`filetype`+`SyntaxStyle`) или `MarkdownRenderable` с ```diff |
| Поле ввода + слэш-команды | `InputRenderable`/`TextareaRenderable` + `SelectRenderable` в overlay-`Box` |
| Модалка разрешений | `@opentui-ui/dialog` `confirm()`/`choice<T>()` |

Источники: [OpenTUI docs](https://opentui.com/docs/) ·
[markdown](https://opentui.com/docs/components/markdown/) ·
[code](https://opentui.com/docs/components/code/) ·
[scrollbox](https://opentui.com/docs/components/scrollbox/) ·
[colors/renderer](https://opentui.com/docs/core-concepts/colors/) ·
[msmps/opentui-ui](https://github.com/msmps/opentui-ui) ·
[termcn](https://www.termcn.dev/docs/theming)

---

## 5. Разрыв: текущий `src/ui.ts` vs целевое

| Аспект | Сейчас | Цель |
|---|---|---|
| Рендер контента | plain-text `TextRenderable`, ручная `Map` частей | `MarkdownRenderable(streaming)` + `CodeRenderable` |
| Прокрутка | хак `scrollTop = MAX` | `stickyScroll` + `stickyStart:"bottom"` |
| Вызовы инструментов | строка `→ читаю файл` | свёрнутая карточка-`Box` с лид-глифом и статусом |
| Диффы | нет | `CodeRenderable` красный/зелёный, unified→split по ширине |
| Тема | 6 хардкод-цветов | семантические роли + адаптив light/dark (OSC 11) + `/theme` |
| Спиннер «думаю» | текст `Думаю…` | анимированный глиф + таймер + токены |
| Слэш-команды | нет | `/` открывает `SelectRenderable`-автокомплит |
| Разрешения | решает сервер по конфигу | инлайн-модалка `@opentui-ui/dialog` (один раз/сессия/нет) |
| Ресайз окна | не обрабатывается | `useOnResize`/перекомпоновка |
| Иконки | эмодзи-риск | ASCII-fallback → single-width Unicode с проверкой ширины |

**Архитектурная рекомендация:** переписать UI с императивного Renderable API на **`@opentui/react`**
(useState для состояния ленты/статуса вместо ручной `Map`; `useKeyboard`/`useOnResize`;
`testRender` для тестов интерфейса).
