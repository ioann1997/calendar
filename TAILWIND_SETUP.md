# Tailwind CSS Setup

Приложение теперь использует Tailwind CSS с Material Design 3 палитрой.

## Структура

- `tailwind.config.js` - конфигурация Tailwind с Material Design 3 цветами
- `src/input.css` - входной CSS файл с кастомными компонентами
- `styles.css` - скомпилированный CSS (генерируется автоматически)

## Команды

### Разработка (с watch режимом)
```bash
npm run build-css
```

### Продакшн (минифицированный)
```bash
npm run build-css-prod
```

## Цветовая палитра Material Design 3

Все цвета доступны через префикс `md-`:

- `md-background` - Основной фон (#faf9ff)
- `md-container` - Фон контейнеров (#dad9e0)
- `md-primary` - Основной цвет (#415f91)
- `md-on-primary` - Текст на основном цвете (#ffffff)
- `md-secondary` - Вторичный цвет (#565f71)
- `md-primary-container` - Контейнер основного цвета (#d6e3ff)
- `md-secondary-container` - Контейнер вторичного цвета (#dae2f9)
- `md-tertiary` - Третичный цвет (#705575)
- `md-tertiary-container` - Контейнер третичного цвета (#fad8fd)
- `md-error` - Цвет ошибки (#ba1a1a)
- `md-error-container` - Контейнер ошибки (#ffdad6)

## Кастомные компоненты

- `.btn-primary` - Основная кнопка
- `.btn-secondary` - Вторичная кнопка
- `.btn-text` - Текстовая кнопка
- `.card` - Карточка
- `.card-elevated` - Карточка с тенью
- `.input-md` - Поле ввода
- `.surface` - Поверхность
- `.surface-container` - Контейнер поверхности

## Обновление стилей

После изменения `src/input.css` или `tailwind.config.js` запустите:
```bash
npm run build-css-prod
```

