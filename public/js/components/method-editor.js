import { escapeHtml } from '../shared/html.js';

let stepSeq = 0;
let groupSeq = 0;

function newStep(text = '') {
  return { key: `step-${stepSeq++}`, text };
}

function newGroup(name = 'Method', steps = [newStep()]) {
  return { key: `group-${groupSeq++}`, name, steps };
}

function stepHtml(step, index) {
  return `
    <div class="method-step" data-step-key="${step.key}">
      <span class="method-step-number">${index + 1}</span>
      <textarea class="method-step-text" rows="2" aria-label="Step ${index + 1}">${escapeHtml(step.text)}</textarea>
      <div class="method-step-actions">
        <button type="button" class="icon-button move-step-up" aria-label="Move step up">↑</button>
        <button type="button" class="icon-button move-step-down" aria-label="Move step down">↓</button>
        <button type="button" class="icon-button remove-step" aria-label="Remove step">✕</button>
      </div>
    </div>
  `;
}

function groupHtml(group, index, total) {
  return `
    <div class="method-group" data-group-key="${group.key}">
      <div class="method-group-header">
        <input type="text" class="group-name-input field" value="${escapeHtml(group.name)}" aria-label="Group name" />
        <div class="ingredient-group-actions">
          <button type="button" class="icon-button move-group-up" ${index === 0 ? 'disabled' : ''} aria-label="Move group up">↑</button>
          <button type="button" class="icon-button move-group-down" ${index === total - 1 ? 'disabled' : ''} aria-label="Move group down">↓</button>
          <button type="button" class="icon-button remove-group" aria-label="Remove group">✕</button>
        </div>
      </div>
      <div class="method-steps">${group.steps.map(stepHtml).join('')}</div>
      <button type="button" class="ghost-button add-step">+ Add step</button>
    </div>
  `;
}

/**
 * Mounts the method (steps) editor (task 7.2) into `container`.
 * @param {{ container: HTMLElement }} options
 */
export function createMethodEditor({ container }) {
  let groups = [newGroup()];

  function render() {
    container.innerHTML = `
      <div class="method-groups">${groups.map((g, i) => groupHtml(g, i, groups.length)).join('')}</div>
      <button type="button" class="ghost-button add-group">+ Add group</button>
    `;
    wireEvents();
  }

  function findGroup(key) {
    return groups.find((g) => g.key === key);
  }

  function wireEvents() {
    container.querySelector('.add-group')?.addEventListener('click', () => {
      groups.push(newGroup());
      render();
    });

    container.querySelectorAll('.method-group').forEach((groupEl) => {
      const groupKey = groupEl.dataset.groupKey;
      const group = findGroup(groupKey);

      groupEl.querySelector('.group-name-input').addEventListener('input', (e) => { group.name = e.target.value; });
      groupEl.querySelector('.move-group-up')?.addEventListener('click', () => {
        const i = groups.findIndex((g) => g.key === groupKey);
        if (i > 0) { [groups[i - 1], groups[i]] = [groups[i], groups[i - 1]]; render(); }
      });
      groupEl.querySelector('.move-group-down')?.addEventListener('click', () => {
        const i = groups.findIndex((g) => g.key === groupKey);
        if (i < groups.length - 1) { [groups[i + 1], groups[i]] = [groups[i], groups[i + 1]]; render(); }
      });
      groupEl.querySelector('.remove-group')?.addEventListener('click', () => {
        groups = groups.filter((g) => g.key !== groupKey);
        if (groups.length === 0) groups = [newGroup()];
        render();
      });
      groupEl.querySelector('.add-step').addEventListener('click', () => {
        group.steps.push(newStep());
        render();
      });

      groupEl.querySelectorAll('.method-step').forEach((stepEl) => {
        const stepKey = stepEl.dataset.stepKey;
        const step = group.steps.find((s) => s.key === stepKey);

        stepEl.querySelector('.method-step-text').addEventListener('input', (e) => { step.text = e.target.value; });
        stepEl.querySelector('.move-step-up').addEventListener('click', () => {
          const i = group.steps.findIndex((s) => s.key === stepKey);
          if (i > 0) { [group.steps[i - 1], group.steps[i]] = [group.steps[i], group.steps[i - 1]]; render(); }
        });
        stepEl.querySelector('.move-step-down').addEventListener('click', () => {
          const i = group.steps.findIndex((s) => s.key === stepKey);
          if (i < group.steps.length - 1) { [group.steps[i + 1], group.steps[i]] = [group.steps[i], group.steps[i + 1]]; render(); }
        });
        stepEl.querySelector('.remove-step').addEventListener('click', () => {
          group.steps = group.steps.filter((s) => s.key !== stepKey);
          if (group.steps.length === 0) group.steps.push(newStep());
          render();
        });
      });
    });
  }

  /** @returns {Array} the `steps` shape: [{ group, steps: [text, …] }] */
  function getValue() {
    return groups
      .filter((g) => g.steps.some((s) => s.text.trim()))
      .map((g) => ({ group: g.name.trim() || 'Method', steps: g.steps.map((s) => s.text.trim()).filter(Boolean) }));
  }

  function setValue(stepGroups) {
    groups = (!stepGroups || stepGroups.length === 0)
      ? [newGroup()]
      : stepGroups.map((g) => newGroup(g.group, (g.steps || []).map((text) => newStep(text))));
    render();
  }

  function reset() {
    groups = [newGroup()];
    render();
  }

  render();
  return { getValue, setValue, reset };
}
