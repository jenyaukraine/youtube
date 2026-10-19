// One scenario timeline for both browser engines. UI and action transport stay in adapters.
window.BrowserCore = Object.freeze({
  scenarioTemplate(chrome = false) {
    const id = name => chrome ? ` id="chrome${name}"` : '';
    return `<section class="scenario-panel worker-control"><div class="scenario-progress-head"><strong>Сценарий</strong><span class="scenario-total"${id('StepCount')}></span><span class="scenario-progress-status"${id('ScenarioStatus')}></span></div>
      <div class="scenario-progress"${id('ScenarioSummary')} hidden><div class="scenario-now"><span class="scenario-now-k"${id('ScenarioNow')}></span><span class="scenario-now-t"></span></div><div class="scenario-action"${id('StepActions')} hidden><span class="scenario-action-t"${id('SelectedStep')}></span><button type="button" class="scenario-run"${id('RunFrom')}>▶ Запустить отсюда</button><button type="button" class="scenario-action-x"${id('ClearStep')} aria-label="Снять выбор" title="Снять выбор">✕</button></div><div class="scenario-track"><i${id('ScenarioTrack')}></i></div><ol class="scenario-steps"${id('StepChips')} aria-label="Шаги сценария"></ol><ol class="action-timeline scenario-detail-list"${id('StepList')} aria-label="Действия сценария"></ol><div class="scenario-step-editor"${id('StepEditor')} hidden></div></div>
      <div class="recorder"><button type="button" class="record-toggle"${id('Record')}>● Записать шаги</button><div class="repeat-control"><input type="number" class="repeat-count"${id('RepeatCount')} min="1" max="100" step="1" value="1" aria-label="Сколько раз повторить"><span>раз</span><button type="button" class="record-replay"${id('Replay')}>▶ Повторить</button></div><button type="button" class="record-save"${id('Save')}>💾 Сохранить</button><select class="macro-pick"${id('MacroPick')} aria-label="Открыть сценарий"><option value="">Открыть сценарий…</option></select><details class="recorder-more"><summary title="Ещё">⋯</summary><div class="recorder-menu"><button type="button" class="record-copy"${id('Copy')}>Копировать шаги как JSON</button><button type="button" class="record-unselect"${id('Unselect')}>Повторять с начала</button><button type="button" class="record-clear"${id('Clear')}>Очистить запись</button><button type="button" class="record-delete-scenario">Удалить сценарий</button></div></details></div><div class="record-status"${id('RunState')} aria-live="polite"></div>
      <details class="scenario-library"><summary>Сохранённые сценарии</summary><div class="scenario-library-list"></div></details>
      <ol class="recorded-steps"${id('RecordedList')}></ol><div class="steps-bulk" hidden><span class="steps-bulk-t"></span><button type="button" class="steps-delete">Удалить выбранные</button><button type="button" class="steps-unpick">Снять выбор</button></div>
      <details class="manual-action"><summary>Ручное действие · точная настройка</summary><div class="control-grid"><select class="action-type"${id('ManualAction')} aria-label="Действие"><option value="click">Кликнуть</option><option value="point">Клик по координатам</option><option value="wait_click">Ждать и кликнуть</option><option value="fill">Ввести текст</option><option value="hover">Навести мышь</option><option value="drag">Перетащить</option><option value="scroll">Прокрутить</option><option value="press">Нажать клавишу</option><option value="navigate">Открыть URL</option><option value="dblclick">Двойной клик</option><option value="type">Печатать по буквам</option><option value="select">Выбрать в списке</option><option value="wait_for">Ждать появления</option><option value="wait_gone">Ждать исчезновения</option><option value="wait">Пауза (мс)</option><option value="text">Прочитать текст</option><option value="screenshot">Скриншот в файлы</option><option value="reload">Перезагрузить</option></select><select class="action-kind"${id('ManualKind')} aria-label="Найти элемент"><option value="css">CSS selector</option><option value="text">Текст</option><option value="label">Label</option><option value="role:button">Роль: кнопка</option><option value="role:link">Роль: ссылка</option><option value="role:textbox">Роль: поле ввода</option><option value="role:checkbox">Роль: checkbox</option><option value="placeholder">Placeholder</option><option value="xpath">XPath</option></select><input class="action-query"${id('ManualQuery')} placeholder="Элемент: CSS, текст, роль или label" aria-label="Элемент"><input class="action-value"${id('ManualValue')} placeholder="Значение" aria-label="Значение" hidden><input class="action-x"${id('ManualX')} type="number" min="0" max="100" step="0.1" placeholder="X, %" aria-label="Координата X, %" hidden><input class="action-y"${id('ManualY')} type="number" min="0" max="100" step="0.1" placeholder="Y, %" aria-label="Координата Y, %" hidden></div><div class="control-help"></div><button type="button" class="worker-action-run"${id('ManualRun')}>Выполнить действие</button></details></section>`;
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
  renderStepEditor(container, step, index, onSave, onDelete) {
    container.replaceChildren();
    container.hidden = !step;
    if (!step) return;
    const form = document.createElement('form');
    const heading = document.createElement('strong'); heading.textContent = `Изменить шаг ${index + 1}`; form.append(heading);
    const fields = [];
    const add = (label, key, value, options = {}) => {
      const wrap = document.createElement('label'); wrap.textContent = label;
      const input = document.createElement('input'); input.name = key; input.value = String(value ?? '');
      if (options.number) { input.type = 'number'; input.step = options.step || '1'; input.min = String(options.min ?? 0); if (options.max != null) input.max = String(options.max); }
      wrap.append(input); form.append(wrap); fields.push([key, input]);
    };
    if (step.action === 'wait') add('Пауза, секунды', 'seconds', (Number(step.value || step.duration_ms || 0) / 1000).toFixed(1), {number:true,step:'0.1',min:0,max:60});
    else if (step.action === 'point') {
      add('Координата X, %', 'x', Math.round((step.x || 0) * 1000) / 10, {number:true,step:'0.1',min:0,max:100});
      add('Координата Y, %', 'y', Math.round((step.y || 0) * 1000) / 10, {number:true,step:'0.1',min:0,max:100});
      add('Селектор элемента', 'query', step.query || '');
      if (step.scroll_state) {
        add('Прокрутка страницы, px', 'scroll_y', step.scroll_state.y || 0, {number:true,min:0});
        step.scroll_state.targets?.forEach((target, i) => add(`Прокрутка области ${i + 1}, px`, `target_${i}`, target.top, {number:true,min:0}));
      }
    } else {
      if (step.query) add('Селектор', 'query', step.query);
      if (step.value !== undefined) add(step.action === 'scroll' ? 'Прокрутка, px' : 'Значение', 'value', step.value, {number:step.action === 'scroll',min:step.action === 'scroll' ? -5000 : 0});
    }
    const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Сохранить шаг'; form.append(save);
    if (onDelete) { const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'step-editor-delete'; remove.textContent = 'Удалить шаг'; remove.onclick = onDelete; form.append(remove); }
    form.addEventListener('submit', event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      const next = structuredClone(step);
      for (const [key, input] of fields) {
        if (key === 'seconds') { next.value = String(Math.round(Number(input.value) * 1000)); delete next.duration_ms; }
        else if (key === 'x' || key === 'y') next[key] = Number(input.value) / 100;
        else if (key === 'scroll_y') next.scroll_state.y = Number(input.value);
        else if (key.startsWith('target_')) next.scroll_state.targets[Number(key.slice(7))].top = Number(input.value);
        else next[key] = input.value;
      }
      onSave(next);
    });
    container.append(form);
  },
  mountStepEditor(list, container, index) {
    const row = index == null ? null : [...list.children].find(item => Number(item.dataset.stepIndex) === index);
    if (row) row.append(container);
    else list.after(container);
  },
  renderLibrary(list, entries, onOpen, onRemove, onRename) {
    list.replaceChildren();
    if (!entries.length) { const empty=document.createElement('p'); empty.textContent='Записанных сценариев пока нет'; list.append(empty); return; }
    for (const entry of entries) {
      const row=document.createElement('div'); row.className='scenario-library-row';
      const open=document.createElement('button'); open.type='button'; open.className='scenario-library-open';
      const title=document.createElement('strong'); title.textContent=entry.name;
      const info=document.createElement('small'); info.textContent=`${entry.steps.length} шагов · ${entry.startUrl||entry.start_url||''}`;
      open.append(title,info); open.onclick=()=>onOpen(entry);
      const remove=document.createElement('button'); remove.type='button'; remove.className='scenario-library-remove'; remove.textContent='Удалить'; remove.setAttribute('aria-label',`Удалить сценарий ${entry.name}`); remove.onclick=()=>onRemove(entry);
      row.append(open);
      if(onRename && entry.choice?.startsWith('scenario:')){
        const edit=document.createElement('button'); edit.type='button'; edit.className='scenario-library-rename'; edit.textContent='✎'; edit.title='Переименовать';
        edit.onclick=()=>{
          open.hidden=true; edit.hidden=true;
          const input=document.createElement('input'); input.className='scenario-library-name'; input.value=entry.name; input.maxLength=80; input.setAttribute('aria-label','Название сценария');
          const finish=save=>{if(save && input.value.trim()) onRename(entry,input.value.trim()); else {input.remove();open.hidden=false;edit.hidden=false;}};
          input.onkeydown=event=>{if(event.key==='Enter')finish(true);if(event.key==='Escape')finish(false);};
          row.prepend(input);input.focus();input.select();
        };
        row.append(edit);
      }
      row.append(remove); list.append(row);
    }
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
