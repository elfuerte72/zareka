// Русские подписи инструментов агента.
const labels: Record<string, string> = {
  read: "читаю файл",
  write: "пишу файл",
  edit: "правлю файл",
  patch: "применяю патч",
  bash: "выполняю команду",
  grep: "ищу по коду",
  glob: "ищу файлы",
  list: "смотрю каталог",
  webfetch: "открываю страницу",
  websearch: "ищу в вебе",
  todowrite: "обновляю план",
  todoread: "смотрю план",
  task: "запускаю подзадачу",
}

export function toolLabel(tool: string): string {
  return labels[tool] ?? tool
}
