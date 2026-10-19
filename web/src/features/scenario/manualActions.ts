import type { ActionName } from '@/lib/types';

// Словари формы «Ручное действие».

export const MANUAL_ACTIONS: { value: ActionName; label: string }[] = [
  { value: 'click', label: 'Кликнуть' },
  { value: 'point', label: 'Клик по координатам' },
  { value: 'wait_click', label: 'Ждать и кликнуть' },
  { value: 'fill', label: 'Ввести текст' },
  { value: 'hover', label: 'Навести мышь' },
  { value: 'drag', label: 'Перетащить' },
  { value: 'scroll', label: 'Прокрутить' },
  { value: 'press', label: 'Нажать клавишу' },
  { value: 'navigate', label: 'Открыть URL' },
  { value: 'dblclick', label: 'Двойной клик' },
  { value: 'type', label: 'Печатать по буквам' },
  { value: 'select', label: 'Выбрать в списке' },
  { value: 'wait_for', label: 'Ждать появления' },
  { value: 'wait_gone', label: 'Ждать исчезновения' },
  { value: 'wait', label: 'Пауза (мс)' },
  { value: 'text', label: 'Прочитать текст' },
  { value: 'screenshot', label: 'Скриншот в файлы' },
  { value: 'reload', label: 'Перезагрузить' },
];

/** Способ поиска элемента; «role:<роль>» раскладывается в kind='role' + role. */
export const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: 'css', label: 'CSS selector' },
  { value: 'text', label: 'Текст' },
  { value: 'label', label: 'Label' },
  { value: 'role:button', label: 'Роль: кнопка' },
  { value: 'role:link', label: 'Роль: ссылка' },
  { value: 'role:textbox', label: 'Роль: поле ввода' },
  { value: 'role:checkbox', label: 'Роль: checkbox' },
  { value: 'placeholder', label: 'Placeholder' },
  { value: 'xpath', label: 'XPath' },
];

export const NEEDS_ELEMENT = new Set<ActionName>([
  'click',
  'wait_click',
  'dblclick',
  'fill',
  'type',
  'hover',
  'drag',
  'select',
  'wait_for',
  'wait_gone',
  'text',
]);

export const NEEDS_VALUE = new Set<ActionName>([
  'fill',
  'type',
  'drag',
  'scroll',
  'press',
  'navigate',
  'select',
  'wait',
  'screenshot',
]);

export const VALUE_PLACEHOLDERS: Partial<Record<ActionName, string>> = {
  fill: 'Текст для ввода',
  drag: 'Цель перетаскивания',
  scroll: 'Пикселей, например 500',
  press: 'Клавиша: Enter, Escape',
  navigate: 'https://example.com',
  type: 'Текст по буквам',
  select: 'Значение option',
  wait: 'Миллисекунды',
  screenshot: 'Имя файла или full',
};
