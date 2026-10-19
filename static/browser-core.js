// One scenario timeline for both browser engines. UI and action transport stay in adapters.
window.BrowserCore = Object.freeze({
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
