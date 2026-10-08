function verifyDuplicates(values) {
    if (new Set(values).size < values.length) {
        document.getElementById('unique').hidden = false;
        restoreOptions();
        return false;
    }
    
    document.getElementById('unique').hidden = true;
    return true;
}

let activeSetter = null;
const setKeyText = '';

async function toggleSetter(id) {
    // if active setter is already the id, set it back to null. If the active setter is not the id, set it to the id
    activeSetter = activeSetter === id ? null : id;
    
    await restoreOptions();
}

async function setBinding(key, value) {
    // only the shapes, storage also holds the AI settings
    let oldItems = await browser.storage.local.get(shapes);
    oldItems[key] = value;
    if (!verifyDuplicates(Object.values(oldItems))) {
        return false;
    }
    let storageItem = {};
    storageItem[activeSetter] = value;
    await browser.storage.local.set(storageItem);
    return true;
}


document.body.onkeydown = async (e) => {
    if (!activeSetter) {
        // if no buttons are active, no point in doing it.
        return;
    }
    if (!acceptableMappings.includes(e.key.toLowerCase())) {
        // If we get an unacceptable key (like someone out here using control), we don't do anything
        // in theory, it may be useful for an "anything goes" type deal, but its probably best for most users to only use standard letters
        return;
    }
    
    // if setting binding succeeds, reset the setter
    if (await setBinding(activeSetter, e.key)) {
        await toggleSetter(activeSetter);
    }
};

const shapes = ['triangle', 'diamond', 'circle', 'square'];

async function restoreOptions() {
    for (const shape of shapes) {
        if (activeSetter === shape) {
            document.getElementById(shape).querySelector('.binding').innerText = setKeyText;
        } else {
            const storageItem = await browser.storage.local.get(shape);
            let value = storageItem[shape];
            if (value === undefined) {
                value = defaults[shape];
                let miniStorageItem = {};
                miniStorageItem[shape] = defaults[shape];
                await browser.storage.local.set(miniStorageItem);
            }
            document.getElementById(shape).querySelector('.binding').innerText = value;
        }
    }
}

const acceptableMappings = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', '`', '-', '=', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12', 'f13', 'f14', 'f15', 'f16', 'f17', 'f18', 'f19', 'f20', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

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
    deepseekModel: 'deepseek-chat',
    groqApiKey: '',
    groqModel: 'llama-3.3-70b-versatile'
};

// Each provider keeps its own key and model, stored as <provider>ApiKey and <provider>Model.
// fallbackModels are shown until the real list is loaded from the API with the user's key
const providers = {
    gemini: {
        name: 'Gemini',
        fallbackModels: ['gemini-flash-latest', 'gemini-flash-lite-latest'],
        async listModels(apiKey) {
            const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
                headers: { 'x-goog-api-key': apiKey }
            });
            const body = await response.json();
            if (!response.ok) {
                throw new Error(body.error?.message ?? `HTTP ${response.status}`);
            }
            return (body.models ?? [])
                .filter(model => model.name.startsWith('models/gemini') && model.supportedGenerationMethods?.includes('generateContent'))
                .map(model => model.name.replace('models/', ''));
        }
    },
    deepseek: {
        name: 'DeepSeek',
        fallbackModels: ['deepseek-chat', 'deepseek-reasoner'],
        async listModels(apiKey) {
            const response = await fetch('https://api.deepseek.com/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            const body = await response.json();
            if (!response.ok) {
                throw new Error(body.error?.message ?? `HTTP ${response.status}`);
            }
            return (body.data ?? []).map(model => model.id);
        }
    },
    groq: {
        name: 'Groq',
        fallbackModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
        async listModels(apiKey) {
            const response = await fetch('https://api.groq.com/openai/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            const body = await response.json();
            if (!response.ok) {
                throw new Error(body.error?.message ?? `HTTP ${response.status}`);
            }
            // Groq also lists speech and moderation models, which can't answer a question
            return (body.data ?? []).map(model => model.id).filter(id => !/whisper|tts|guard/i.test(id)).sort();
        }
    }
};

function setModelOptions(models, selected) {
    const select = document.getElementById('aiModel');
    // always keep the saved model in the list, even if the API doesn't return it
    select.replaceChildren(...[...new Set([selected, ...models])].map(model => new Option(model, model)));
    select.value = selected;
}

async function loadModels() {
    const status = document.getElementById('aiStatus');
    const provider = document.getElementById('aiProvider').value;
    const apiKey = document.getElementById('aiApiKey').value.trim();
    if (apiKey === '') {
        status.innerText = `Enter a ${providers[provider].name} API key to load the list of models.`;
        return;
    }

    try {
        const models = await providers[provider].listModels(apiKey);
        // the provider may have been switched while waiting for the list
        if (document.getElementById('aiProvider').value !== provider) {
            return;
        }
        setModelOptions(models, document.getElementById('aiModel').value);
        status.innerText = `${models.length} models available with this key.`;
    } catch (e) {
        status.innerText = `Could not load models: ${e.message}`;
    }
}

// Fills the key and model fields with the ones saved for the selected provider
async function showProvider() {
    const provider = document.getElementById('aiProvider').value;
    const settings = { ...aiDefaults, ...await browser.storage.local.get(Object.keys(aiDefaults)) };
    document.getElementById('aiApiKey').value = settings[`${provider}ApiKey`];
    setModelOptions(providers[provider].fallbackModels, settings[`${provider}Model`]);
    await loadModels();
}

async function restoreAiOptions() {
    const settings = { ...aiDefaults, ...await browser.storage.local.get(Object.keys(aiDefaults)) };
    document.getElementById('aiEnabled').checked = settings.aiEnabled;
    document.getElementById('aiProvider').replaceChildren(
        ...Object.keys(providers).map(provider => new Option(providers[provider].name, provider))
    );
    document.getElementById('aiProvider').value = settings.aiProvider;

    document.getElementById('aiEnabled').onchange = async (e) => {
        await browser.storage.local.set({ aiEnabled: e.target.checked });
    };
    document.getElementById('aiProvider').onchange = async (e) => {
        await browser.storage.local.set({ aiProvider: e.target.value });
        await showProvider();
    };
    // saved on every keystroke, the popup can close without a change event
    document.getElementById('aiApiKey').oninput = async (e) => {
        const provider = document.getElementById('aiProvider').value;
        await browser.storage.local.set({ [`${provider}ApiKey`]: e.target.value.trim() });
    };
    document.getElementById('aiApiKey').onchange = loadModels;
    document.getElementById('aiModel').onchange = async (e) => {
        const provider = document.getElementById('aiProvider').value;
        await browser.storage.local.set({ [`${provider}Model`]: e.target.value });
    };

    document.getElementById('aiForce').onclick = async (e) => {
        e.preventDefault();
        // kahoot.js watches this value and answers the question on screen, even if the checkbox is off
        await browser.storage.local.set({ aiForce: Date.now() });
        document.getElementById('aiStatus').innerText = 'Request sent to the Kahoot tab.';
    };

    await showProvider();
}

document.addEventListener('DOMContentLoaded', async () => {
    await restoreOptions();
    await restoreAiOptions();
    for (const shape of shapes) {
        document.getElementById(shape).onclick = async (e) => {
            e.preventDefault();
            await toggleSetter(shape);
        };
    }
    
    document.getElementById('reset').onclick = async (e) => {
        e.preventDefault();
        await browser.storage.local.set(defaults);
        await toggleSetter(null);
    };
    
    document.getElementById('overlay').onclick = async (e) => {
        e.preventDefault();
        await toggleSetter(null);
    };
});
