const defaults = {
    triangle: 'o',
    circle: 's',
    diamond: 'p',
    square: 'd'
};

const aiDefaults = {
    aiEnabled: false,
    aiProvider: 'gemini',
    geminiApiKey: '',
    geminiModel: 'gemini-flash-latest',
    deepseekApiKey: '',
    deepseekModel: 'deepseek-chat'
};

// Kahoot answers now have classes like answer-0, or answer-1
// So I order them, and use index in array to identify
const shapes = ['triangle', 'diamond', 'circle', 'square'];

// True or false questions don't follow that order (answer-0 is the diamond),
// so the shape is read from the start of the icon's svg path when possible
const iconPaths = {
    triangle: 'M27,24.5',
    diamond: 'M4,16.0',
    circle: 'M16,27 C',
    square: 'M7,7 L25'
};

// Each shape always has the same color, the AI answers with the color
const colors = {
    triangle: 'red',
    diamond: 'blue',
    circle: 'yellow',
    square: 'green'
};

function readAnswers() {
    return [...document.querySelectorAll('button[data-functional-selector^="answer-"]')].map(button => {
        const index = Number(button.dataset.functionalSelector.slice('answer-'.length));
        const icon = button.querySelector('svg path')?.getAttribute('d') ?? '';
        const shape = shapes.find(candidate => icon.startsWith(iconPaths[candidate])) ?? shapes[index];
        return { button, index, shape, color: colors[shape], text: selectorText(`question-choice-text-${index}`, button) };
    });
}

// Kahoot ignores clicks and keys that don't come from a real mouse or keyboard (isTrusted),
// so kahoot-main.js, which runs in the page's own world, is asked to call the button's handler
function pressAnswer(answer) {
    console.log('[Kahoot AI]', `pressing answer-${answer.index} (${answer.color})`);
    answer.button.dispatchEvent(new CustomEvent('kahoot-shortcuts-press', { bubbles: true }));

    setTimeout(() => {
        const accepted = !answer.button.isConnected || answer.button.disabled;
        console.log('[Kahoot AI]', accepted ? 'answer accepted' : 'answer still on screen, the press was not accepted');
    }, 300);
}

// When the extension is reloaded, the copy of this script left in an already open page loses access
// to the browser API ("Extension context invalidated"), so it stops itself and asks for a refresh
function extensionGone() {
    if (browser.runtime?.id !== undefined) {
        return false;
    }
    window.removeEventListener("keydown", keyDown);
    questionObserver.disconnect();
    clearTimeout(autoAnswerTimeout);
    showNotice('the extension was reloaded, refresh this page');
    return true;
}

async function keyDown(oKeyEvent) {
    if (extensionGone()) {
        return;
    }
    const shape = await fetchShape(oKeyEvent.key);

    if (shape !== undefined) {
        const answer = readAnswers().find(candidate => candidate.shape === shape);
        if (answer !== undefined) {
            pressAnswer(answer);
        }
    } else if (oKeyEvent.key.toLowerCase() === 'enter') {
        document.querySelector('[data-functional-selector="multi-select-submit-button"]')?.click();
    }
}

async function fetchShape(key) {
    // only the shapes, storage also holds the AI settings
    let storageItem = await browser.storage.local.get(shapes);
    if (Object.keys(storageItem).length === 0) {
        storageItem = defaults;
        await browser.storage.local.set(defaults);
    }
    return getKeyByValue(storageItem, key);
}

function getKeyByValue(object, value) {
    return Object.keys(object).find(key => object[key] === value);
}

window.addEventListener("keydown", keyDown);

// --- Auto response answer with AI ---

// Shown in the console of the kahoot.it tab, filter on "Kahoot AI"
function log(...args) {
    console.log('[Kahoot AI]', ...args);
}

function selectorText(selector, root = document) {
    return root.querySelector(`[data-functional-selector="${selector}"]`)?.textContent.trim() ?? '';
}

// Returns null when no answer buttons are on screen
function readQuestion() {
    const answers = readAnswers();
    if (answers.length === 0) {
        return null;
    }

    return {
        number: selectorText('question-index-counter'),
        title: selectorText('block-title'),
        multiSelect: document.querySelector('[data-functional-selector="multi-select-submit-button"]') !== null,
        answers: answers.map(answer => ({ color: answer.color, text: answer.text }))
    };
}

function showNotice(text, retry = false) {
    let notice = document.getElementById('kahoot-shortcuts-ai-notice');
    if (notice === null) {
        notice = document.createElement('div');
        notice.id = 'kahoot-shortcuts-ai-notice';
        notice.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
            'padding:6px 12px;border-radius:6px;background:rgba(0,0,0,0.8);color:#fff;font:14px sans-serif;pointer-events:none;';
        document.body.appendChild(notice);
    }
    notice.textContent = `AI: ${text}`;

    if (retry) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Retry';
        button.style.cssText = 'margin-left:8px;padding:2px 8px;border:0;border-radius:4px;background:#fff;color:#000;' +
            'font:inherit;cursor:pointer;pointer-events:auto;';
        button.onclick = () => {
            // forget the question so it is sent again
            log('retry clicked');
            lastQuestionKey = null;
            autoAnswer(true);
        };
        notice.appendChild(button);
    }
}

// The request is sent by background.js (see there), returns the JSON body of the reply
async function apiPost(url, headers, body) {
    const reply = await browser.runtime.sendMessage({
        type: 'apiFetch',
        url,
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body)
        }
    });
    if (reply.error !== undefined) {
        throw new Error(reply.error);
    }

    log(`reply HTTP ${reply.status}`, reply.body);
    if (!reply.ok) {
        throw new Error(reply.body?.error?.message ?? `HTTP ${reply.status}`);
    }
    return reply.body;
}

// Both return the raw text of the model's reply
async function askGemini(prompt, available, apiKey, model) {
    const body = await apiPost(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { 'x-goog-api-key': apiKey },
        {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0,
                responseMimeType: 'text/x.enum',
                responseSchema: { type: 'STRING', enum: available }
            }
        }
    );
    return (body?.candidates?.[0]?.content?.parts ?? []).map(part => part.text ?? '').join('');
}

async function askDeepSeek(prompt, available, apiKey, model) {
    const body = await apiPost(
        'https://api.deepseek.com/chat/completions',
        { 'Authorization': `Bearer ${apiKey}` },
        {
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            stream: false
        }
    );
    return body?.choices?.[0]?.message?.content ?? '';
}

const providers = {
    gemini: { name: 'Gemini', ask: askGemini },
    deepseek: { name: 'DeepSeek', ask: askDeepSeek }
};

async function askAI(question, provider, apiKey, model) {
    const available = question.answers.map(answer => answer.color);
    const prompt = 'You are answering a multiple-choice quiz question. ' +
        'Reply with the color of the correct answer and nothing else.\n\n' +
        `Question: ${question.title}\n` +
        question.answers.map(answer => `${answer.color}: ${answer.text}`).join('\n');

    log(`asking ${providers[provider].name} ${model}\n${prompt}`);
    const start = performance.now();
    const text = (await providers[provider].ask(prompt, available, apiKey, model)).toLowerCase();
    log(`replied "${text}" after ${Math.round(performance.now() - start)} ms`);

    const color = available.find(candidate => text.includes(candidate));
    if (color === undefined) {
        throw new Error(`unexpected reply "${text}"`);
    }
    return color;
}

let lastQuestionKey = null;

// force: asked by the user (options button or Retry), runs even if the checkbox is off
async function autoAnswer(force = false) {
    if (extensionGone()) {
        return;
    }
    const question = readQuestion();
    if (question === null) {
        if (force) {
            log('forced, but there is no question on screen');
            showNotice('no question on screen');
        }
        return;
    }

    // each question is only handled once
    const key = JSON.stringify(question);
    if (key === lastQuestionKey) {
        return;
    }
    lastQuestionKey = key;

    log('question detected', question);

    const settings = { ...aiDefaults, ...await browser.storage.local.get(Object.keys(aiDefaults)) };
    if (!settings.aiEnabled && !force) {
        log('skipped: auto response is disabled in the options');
        return;
    }

    if (question.multiSelect) {
        log('skipped: multi-select question');
        showNotice('multi-select questions are not supported, answer manually');
        return;
    }
    // The host can hide questions and answers on the players' devices, then there is nothing to send to the AI
    if (question.title === '' || question.answers.some(answer => answer.text === '' || answer.color === undefined)) {
        log('skipped: question or answers are not displayed on this device');
        showNotice('question or answers are not displayed on this device, answer manually');
        return;
    }
    const provider = providers[settings.aiProvider] === undefined ? aiDefaults.aiProvider : settings.aiProvider;
    const apiKey = settings[`${provider}ApiKey`];
    if (apiKey === '') {
        log(`skipped: no ${providers[provider].name} API key`);
        showNotice(`no ${providers[provider].name} API key set in the extension options`, true);
        return;
    }

    showNotice('thinking…');
    try {
        const color = await askAI(question, provider, apiKey, settings[`${provider}Model`]);
        // the question may have ended while waiting for the reply
        if (lastQuestionKey !== key) {
            log(`ignored "${color}": the question changed while waiting for the reply`);
            return;
        }
        const answer = readAnswers().find(candidate => candidate.color === color);
        if (answer === undefined) {
            log(`ignored "${color}": the answer buttons are gone`);
            return;
        }
        showNotice(color);
        log(`clicking ${color} (${answer.shape}): ${answer.text}`);
        pressAnswer(answer);
    } catch (e) {
        console.error('[Kahoot AI]', e);
        showNotice(`error, answer manually (${e.message})`, true);
    }
}

// The options page can't call this script directly, its button writes aiForce to the storage instead
browser.storage.onChanged.addListener((changes) => {
    if (changes.aiForce !== undefined) {
        log('forced from the options');
        lastQuestionKey = null;
        autoAnswer(true);
    }
});

let autoAnswerTimeout = null;

const questionObserver = new MutationObserver(() => {
    // Kahoot renders a question in several steps, so wait until the page settles
    clearTimeout(autoAnswerTimeout);
    autoAnswerTimeout = setTimeout(autoAnswer, 100);
});
questionObserver.observe(document.documentElement, { childList: true, subtree: true });
