import { escapeHtml } from '../lib/dom.js';
import { generateRecipe, fetchGenerationQuota } from '../lib/api.js';

const SUGGESTED_PROMPTS = ['High-protein packed lunch', 'Spicy dal for tonight', 'Healthy Indo-Chinese', 'British classic, Indian twist', 'Low-sugar dessert', 'Quick chaat'];
const CLIENT_TIMEOUT_MS = 90_000;

function formatResetTime(resetsAtIso) {
  try {
    return new Date(resetsAtIso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return 'midnight';
  }
}

/**
 * The "Describe a recipe" flow (tasks 10.1, 10.2, 10.6): builds the whole panel inside `container`
 * and calls `onDraftReady(draft, generationId, warnings)` on a successful (200) generation.
 * @param {{ container: HTMLElement, onDraftReady: Function, mealType?: string, initialPrompt?: string }} options
 */
export function createGenerateFlow({ container, onDraftReady, mealType, initialPrompt }) {
  let state = 'idle'; // idle | verifying | generating | error
  let abortController = null;
  let elapsedSeconds = 0;
  let elapsedIntervalId = null;
  let quota = null;
  let errorInfo = null; // { kind, message, matches?, resetsAt? }
  let lastPrompt = '';

  function render() {
    const quotaLine = quota
      ? `${Math.min(quota.remainingToday, quota.remainingForYou)} generations left today`
      : '';
    const quotaExhausted = quota && (quota.remainingToday <= 0 || quota.remainingForYou <= 0);

    container.innerHTML = `
      <section class="generate-panel">
        <h2>Describe a recipe</h2>
        ${quotaExhausted
          ? `<p class="notice">${escapeHtml(quotaLine || 'No generations left today.')}</p>`
          : `
            <label class="field full-width">
              <span>What would you like to cook?</span>
              <textarea id="generatePrompt" rows="2" placeholder="e.g. a lighter pav bhaji for a weeknight, serves 4">${escapeHtml(lastPrompt)}</textarea>
            </label>
            <div class="chip-group" id="generateSuggestedPrompts">
              ${SUGGESTED_PROMPTS.map((p) => `<button type="button" class="chip" data-prompt="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}
            </div>
            <div class="form-grid">
              <label class="field"><span>Serves</span><input type="number" id="generateServes" min="1" max="12" placeholder="4" /></label>
              <label class="field"><span>Max time (minutes)</span><input type="number" id="generateMaxMinutes" min="5" max="480" placeholder="45" /></label>
              <label class="checkbox-field"><input type="checkbox" id="generateVegetarian" /><span>Vegetarian</span></label>
              <label class="checkbox-field"><input type="checkbox" id="generateEggFree" /><span>Egg-free</span></label>
              <label class="checkbox-field"><input type="checkbox" id="generateDairyFree" /><span>Dairy-free</span></label>
            </div>
            <div class="field">
              <span>Health goal</span>
              <div class="yes-no-radio" role="radiogroup" aria-label="Health goal">
                <label><input type="radio" name="generateGoal" value="auto" checked /><span>Let the app decide</span></label>
                <label><input type="radio" name="generateGoal" value="protein_smart" /><span>Protein-smart</span></label>
                <label><input type="radio" name="generateGoal" value="balanced" /><span>Balanced</span></label>
              </div>
              <span class="hint" id="generateGoalShare"></span>
            </div>
            <div class="status-region" id="generateStatus" aria-live="polite"></div>
            ${renderStateBanner()}
            <div class="form-actions">
              <button type="button" class="primary-button" id="generateSubmit" ${state === 'verifying' || state === 'generating' ? 'disabled' : ''}>
                ${state === 'verifying' ? 'Checking…' : 'Generate recipe'}
              </button>
              ${state === 'generating' ? `<button type="button" class="ghost-button" id="generateCancel">Cancel</button>` : ''}
            </div>
            <p class="notice">${escapeHtml(quotaLine)}</p>
          `}
      </section>
    `;
    wireEvents();
  }

  function renderStateBanner() {
    if (state === 'generating') {
      return `<p class="notice" id="generateElapsedNotice">Writing your recipe… ${elapsedSeconds}s</p>`;
    }
    if (state === 'error' && errorInfo) {
      if (errorInfo.kind === 'similar') {
        return `
          <div class="empty-state">
            <p>You already have: ${errorInfo.matches.map((m) => `<a href="recipes.html?recipe=${encodeURIComponent(m.slug || '')}">${escapeHtml(m.name)}</a>`).join(', ')}</p>
            <button type="button" class="ghost-button" id="generateAnyway">Generate anyway</button>
          </div>
        `;
      }
      return `<p class="field-error">${escapeHtml(errorInfo.message)}</p>`;
    }
    return '';
  }

  function setState(next, info = null) {
    state = next;
    errorInfo = info;
    render();
  }

  function startElapsedTimer() {
    elapsedSeconds = 0;
    elapsedIntervalId = setInterval(() => {
      elapsedSeconds += 1;
      const statusRegion = document.getElementById('generateStatus');
      if (statusRegion) statusRegion.textContent = `Writing your recipe… ${elapsedSeconds}s`;
      const banner = document.getElementById('generateElapsedNotice');
      if (banner) banner.textContent = `Writing your recipe… ${elapsedSeconds}s`;
    }, 1000);
  }

  function stopElapsedTimer() {
    clearTimeout(elapsedIntervalId);
    clearInterval(elapsedIntervalId);
    elapsedIntervalId = null;
  }

  async function refreshQuota() {
    const result = await fetchGenerationQuota();
    if (result.ok) quota = result.data;
    render();
  }

  function readConstraints() {
    const constraints = {};
    const serves = document.getElementById('generateServes')?.value;
    if (serves) constraints.serves = Number(serves);
    if (document.getElementById('generateVegetarian')?.checked) constraints.vegetarian = true;
    if (document.getElementById('generateEggFree')?.checked) constraints.eggFree = true;
    if (document.getElementById('generateDairyFree')?.checked) constraints.dairyFree = true;
    const maxMinutes = document.getElementById('generateMaxMinutes')?.value;
    if (maxMinutes) constraints.maxTotalMinutes = Number(maxMinutes);
    return constraints;
  }

  async function submit({ force = false } = {}) {
    const promptInput = document.getElementById('generatePrompt');
    const prompt = (promptInput?.value || lastPrompt).trim();
    if (prompt.length < 3) {
      setState('error', { kind: 'other', message: 'Describe the dish in a few more words.' });
      return;
    }
    lastPrompt = prompt;
    const constraints = readConstraints();
    const goal = document.querySelector('input[name="generateGoal"]:checked')?.value || 'auto';

    setState('verifying');
    // Let "Checking…" actually paint before the (usually brief) Turnstile solve + the long model
    // call run back to back — otherwise this synchronous handoff would skip straight to
    // "generating" without the browser ever getting a frame to show the verifying state.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), CLIENT_TIMEOUT_MS);

    setState('generating');
    startElapsedTimer();

    const turnstileContainer = document.getElementById('turnstileContainer');
    const result = await generateRecipe({ prompt, constraints, goal, mealType, force, turnstileContainer, signal: abortController.signal });

    clearTimeout(timeoutId);
    stopElapsedTimer();

    if (result.ok) {
      await refreshQuota();
      onDraftReady?.(result.data.draft, result.data.generationId, result.data.warnings, { effectiveGoal: result.data.effectiveGoal, goalAdjusted: result.data.goalAdjusted });
      setState('idle');
      return;
    }

    if (result.code === 'aborted') {
      setState('idle');
      return;
    }
    if (result.code === 'similar_exists') {
      setState('error', { kind: 'similar', matches: result.matches || [] });
      return;
    }
    if (result.code === 'not_a_recipe') {
      setState('error', { kind: 'other', message: "That doesn't look like a recipe request. Try describing a dish." });
      return;
    }
    if (result.code === 'generation_limit') {
      setState('error', { kind: 'other', message: `Daily generation limit reached. It resets at ${formatResetTime(result.resetsAt)}. You can still add recipes by hand.` });
      await refreshQuota();
      return;
    }
    if (result.status === 502 || result.status === 503) {
      setState('error', { kind: 'other', message: "Couldn't generate a recipe right now. Try again, or add it by hand." });
      return;
    }
    setState('error', { kind: 'other', message: result.message || "Couldn't generate a recipe right now. Try again, or add it by hand." });
  }

  function wireEvents() {
    document.getElementById('generateSubmit')?.addEventListener('click', () => submit());
    document.getElementById('generateCancel')?.addEventListener('click', () => abortController?.abort());
    document.getElementById('generateAnyway')?.addEventListener('click', () => submit({ force: true }));
    document.getElementById('generatePrompt')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });
    container.querySelectorAll('#generateSuggestedPrompts .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const input = document.getElementById('generatePrompt');
        if (input) input.value = chip.dataset.prompt;
      });
    });

    const goalShare = document.getElementById('generateGoalShare');
    if (goalShare && quota) {
      goalShare.textContent = `${Math.round((quota.proteinSmartShare ?? 0) * 100)}% of recent AI recipes are protein-smart (target 60%)`;
    }
  }

  if (initialPrompt) lastPrompt = initialPrompt;
  render();
  refreshQuota();

  return { refreshQuota };
}
