#!/usr/bin/env bash
# Зарека — установщик пресета Yandex AI Studio для opencode.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${HOME}/.config/opencode"
CONFIG_FILE="${CONFIG_DIR}/opencode.json"
PROMPT_FILE="${CONFIG_DIR}/zareka.ru.md"
PRESET_FILE="${SCRIPT_DIR}/presets/yandex-ai-studio.opencode.json"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }

bold "Зарека: настройка opencode под Yandex AI Studio"
echo

if ! command -v opencode >/dev/null 2>&1; then
  echo "⚠ opencode не найден. Установите его и запустите скрипт снова:"
  echo "  curl -fsSL https://opencode.ai/install | bash"
  echo "  (или: npm install -g opencode-ai)"
  exit 1
fi

read -rp "Folder ID каталога Yandex Cloud (вида b1g...): " FOLDER_ID
if [[ -z "${FOLDER_ID}" ]]; then
  echo "Folder ID обязателен — его видно в консоли Yandex Cloud в списке каталогов."
  exit 1
fi

mkdir -p "${CONFIG_DIR}"

# Существующий конфиг не трогаем молча — сохраняем бэкап рядом.
if [[ -f "${CONFIG_FILE}" ]]; then
  BACKUP="${CONFIG_FILE}.backup-$(date +%Y%m%d-%H%M%S)"
  cp "${CONFIG_FILE}" "${BACKUP}"
  echo "Существующий конфиг сохранён: ${BACKUP}"
fi

sed "s/{FOLDER_ID}/${FOLDER_ID}/g" "${PRESET_FILE}" > "${CONFIG_FILE}"
cp "${SCRIPT_DIR}/prompts/zareka.ru.md" "${PROMPT_FILE}"

echo
bold "Готово. Осталось два шага:"
echo "1. Экспортируйте API-ключ (лучше добавить в ~/.zshrc или ~/.bashrc):"
echo "   export YANDEX_API_KEY=\"ваш-ключ\""
echo "2. Запустите агента в каталоге вашего проекта:"
echo "   opencode"
