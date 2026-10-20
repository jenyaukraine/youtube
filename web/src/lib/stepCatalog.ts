import type { ActionName, Kind } from './types';

// Словари шагов: подписи действий и способов поиска, поля редактора, подсказки.

export const KIND_LABELS: Record<Kind, string> = {
  css: 'селектор',
  text: 'текст',
  role: 'роль',
  label: 'подпись',
  placeholder: 'placeholder',
  xpath: 'xpath',
};

export const ACTION_LABELS: Record<ActionName, string> = {
  navigate: 'Открыть URL',
  reload: 'Перезагрузить',
  back: 'Назад',
  click: 'Клик',
  wait_click: 'Дождаться и кликнуть',
  dblclick: 'Двойной клик',
  point: 'Клик по точке',
  move: 'Курсор',
  mouse_drag: 'Выделение мышью',
  inspect: 'Осмотр',
  fill: 'Заполнить',
  type: 'Ввод текста',
  press: 'Клавиша',
  hover: 'Навести',
  drag: 'Перетащить',
  scroll: 'Прокрутка',
  select: 'Выбрать',
  wait: 'Пауза',
  wait_for: 'Ждать появления',
  wait_gone: 'Ждать исчезновения',
  wait_url: 'Ждать URL',
  text: 'Прочитать текст',
  attribute: 'Атрибут',
  exists: 'Проверить',
  count: 'Посчитать',
  screenshot: 'Скриншот',
  page_text: 'Текст страницы',
};

export type StepField = 'kind' | 'query' | 'value' | 'x' | 'y' | 'end_x' | 'end_y';

/** Какие поля редактора нужны действию. */
export const STEP_FIELDS: Record<ActionName, StepField[]> = {
  wait: ['value'],
  point: ['x', 'y'],
  move: ['x', 'y'],
  inspect: ['x', 'y'],
  mouse_drag: ['x', 'y', 'end_x', 'end_y'],
  click: ['kind', 'query'],
  wait_click: ['kind', 'query'],
  dblclick: ['kind', 'query'],
  hover: ['kind', 'query'],
  wait_for: ['kind', 'query'],
  wait_gone: ['kind', 'query'],
  text: ['kind', 'query'],
  exists: ['kind', 'query'],
  count: ['kind', 'query'],
  fill: ['kind', 'query', 'value'],
  select: ['kind', 'query', 'value'],
  drag: ['kind', 'query', 'value'],
  attribute: ['kind', 'query', 'value'],
  type: ['value', 'kind', 'query'],
  scroll: ['value', 'kind', 'query'],
  press: ['value'],
  navigate: ['value'],
  wait_url: ['value'],
  screenshot: ['value'],
  page_text: ['value'],
  reload: [],
  back: [],
};

export const STEP_HINTS: Partial<Record<ActionName, string>> = {
  wait: 'Пауза в миллисекундах: 1000 = 1 секунда.',
  point: 'Точка на кадре в долях ширины и высоты: 0.5, 0.5 — центр.',
  move: 'Курсор переместится в точку без клика.',
  mouse_drag: 'Нажать в точке X/Y, протянуть до «Конец X/Y», отпустить.',
  click: 'Способ поиска и сам элемент: CSS-селектор, видимый текст, роль или подпись.',
  wait_click: 'Ждёт появления элемента до 2 минут и кликает один раз.',
  fill: 'Очищает поле и вводит значение; можно {{переменную}}.',
  type: 'Печатает по буквам в активное поле; элемент указывать не обязательно.',
  press: 'Клавиша: Enter, Escape, Tab, ArrowDown, Control+A.',
  scroll:
    'Пикселей прокрутки: положительное — вниз, отрицательное — вверх. Или элемент, к которому прокрутить.',
  navigate: 'Полный адрес с http:// или https://.',
  drag: 'Элемент-источник слева, элемент-цель в значении.',
  select: 'Значение option в выпадающем списке.',
  screenshot: '«full» — вся страница, иначе видимая часть.',
};
