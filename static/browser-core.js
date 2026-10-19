// One scenario timeline for both browser engines. UI and action transport stay in adapters.
window.BrowserCore = Object.freeze({
  scenarioTemplate(chrome = false) {
    const id = name => chrome ? ` id="chrome${name}"` : '';
    return `<section class="scenario-panel worker-control"><div class="scenario-progress-head"><strong>Сценарий</strong><span class="scenario-total"${id('StepCount')}></span><span class="scenario-progress-status"${id('ScenarioStatus')}></span></div>
      <div class="scenario-progress"${id('ScenarioSummary')} hidden><div class="scenario-now"><span class="scenario-now-k"${id('ScenarioNow')}></span><span class="scenario-now-t"></span></div><div class="scenario-action"${id('StepActions')} hidden><span class="scenario-action-t"${id('SelectedStep')}></span><button type="button" class="scenario-run"${id('RunFrom')}>▶ Запустить отсюда</button><button type="button" class="scenario-action-x"${id('ClearStep')} aria-label="Снять выбор" title="Снять выбор">✕</button></div><div class="scenario-track"><i${id('ScenarioTrack')}></i></div><ol class="scenario-steps"${id('StepChips')} aria-label="Шаги сценария"></ol><ol class="action-timeline scenario-detail-list"${id('StepList')} aria-label="Действия сценария"></ol></div>
      <div class="recorder"><button type="button" class="record-toggle"${id('Record')}>● Записать шаги</button><div class="repeat-control"><input type="number" class="repeat-count"${id('RepeatCount')} min="1" max="100" step="1" value="1" aria-label="Сколько раз повторить"><span>раз</span><button type="button" class="record-replay"${id('Replay')}>▶ Повторить</button></div><button type="button" class="record-save"${id('Save')}>💾 Сохранить</button><select class="macro-pick"${id('MacroPick')} aria-label="Открыть сценарий"><option value="">Открыть сценарий…</option></select><details class="recorder-more"><summary title="Ещё">⋯</summary><div class="recorder-menu"><button type="button" class="record-copy"${id('Copy')}>Копировать шаги как JSON</button><button type="button" class="record-unselect"${id('Unselect')}>Повторять с начала</button><button type="button" class="record-clear"${id('Clear')}>Очистить запись</button></div></details></div><div class="record-status"${id('RunState')} aria-live="polite"></div>
      <ol class="recorded-steps"${id('RecordedList')}></ol><div class="steps-bulk" hidden><span class="steps-bulk-t"></span><button type="button" class="steps-delete">Удалить выбранные</button><button type="button" class="steps-unpick">Снять выбор</button></div>
      <details class="manual-action"><summary>Ручное действие по селектору · для точной настройки</summary><div class="control-grid"><select class="action-type"${id('ManualAction')} aria-label="Действие"><option value="click">Кликнуть</option><option value="wait_click">Ждать и кликнуть</option><option value="fill">Ввести текст</option><option value="hover">Навести мышь</option><option value="drag">Перетащить</option><option value="scroll">Прокрутить</option><option value="press">Нажать клавишу</option><option value="navigate">Открыть URL</option><option value="dblclick">Двойной клик</option><option value="type">Печатать по буквам</option><option value="select">Выбрать в списке</option><option value="wait_for">Ждать появления</option><option value="wait_gone">Ждать исчезновения</option><option value="wait">Пауза (мс)</option><option value="text">Прочитать текст</option><option value="screenshot">Скриншот в файлы</option><option value="reload">Перезагрузить</option></select><select class="action-kind"${id('ManualKind')} aria-label="Найти элемент"><option value="css">CSS selector</option><option value="text">Текст</option><option value="label">Label</option><option value="role:button">Роль: кнопка</option><option value="role:link">Роль: ссылка</option><option value="role:textbox">Роль: поле ввода</option><option value="role:checkbox">Роль: checkbox</option><option value="placeholder">Placeholder</option><option value="xpath">XPath</option></select><input class="action-query"${id('ManualQuery')} placeholder="Элемент: CSS, текст, роль или label" aria-label="Элемент"><input class="action-value"${id('ManualValue')} placeholder="Значение" aria-label="Значение" hidden></div><div class="control-help"></div><button type="button" class="worker-action-run"${id('ManualRun')}>Выполнить действие</button></details></section>`;
  },
  renderChips(list, steps, describe) {
    list.replaceChildren(...steps.map((step, index) => {
      const item = document.createElement('li'); item.dataset.stepIndex = index;
      const number = document.createElement('b'); number.textContent = index + 1;
      const label = document.createElement('span'); label.textContent = describe(step);
      item.append(number, label); item.title = `${index + 1}. ${describe(step)} — нажми, чтобы начать с этого шага`;
      return item;
    }));
  },
  renderTimeline(list, steps, describe) {
    list.replaceChildren(...steps.map((step, index) => {
      const item = document.createElement('li'); item.dataset.stepIndex = index;
      const number = document.createElement('b'); number.textContent = index + 1;
      const label = document.createElement('span'); label.textContent = describe(step);
      item.append(number, label); return item;
    }));
  },
  markTimeline(list, {current = -1, completed = 0, failed = -1, selected = -1} = {}) {
    [...list.children].forEach((item, index) => {
      item.classList.toggle('current', index === current);
      item.classList.toggle('done', index < completed);
      item.classList.toggle('failed', index === failed);
      item.classList.toggle('selected', index === selected);
    });
  },
  async run({steps, from = 0, repeats = 1, execute, onStep = () => {}, onRepeat = () => {}, shouldStop = () => false, delayBetween = 0}) {
    if (!Array.isArray(steps) || !steps.length) throw new Error('В сценарии нет шагов');
    const start = Math.max(0, Math.min(steps.length - 1, Number(from) || 0));
    let completed = 0;
    for (let pass = 0; pass < repeats && !shouldStop(); pass++) {
      await onRepeat(pass, repeats);
      for (let index = start; index < steps.length && !shouldStop(); index++) {
        await onStep(index, pass, steps[index]);
        const result = await execute(steps[index], index, pass);
        if (!result?.ok) return {ok: false, completed, pass, index, stopped: shouldStop(), error: result?.error || 'Действие не выполнено'};
        if (delayBetween && index < steps.length - 1 && !steps.some(step => step.action === 'wait')) await new Promise(resolve => setTimeout(resolve, delayBetween));
      }
      if (!shouldStop()) completed++;
    }
    return {ok: !shouldStop(), completed, stopped: shouldStop()};
  }
});
