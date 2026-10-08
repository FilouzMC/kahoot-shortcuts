// kahoot.js runs inside the kahoot.it page, where requests to other sites are subject to the page's
// cross-origin rules, which Chrome and Firefox don't apply the same way. Its API requests are sent
// from here instead, where the host permissions of the manifest apply in both browsers.
// (chrome.* is used rather than browser.*, it exists in both and the polyfill isn't loaded here)
const allowedOrigins = [
    'https://generativelanguage.googleapis.com',
    'https://api.deepseek.com'
];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'apiFetch' || !allowedOrigins.includes(new URL(message.url).origin)) {
        return false;
    }

    fetch(message.url, message.init)
        .then(async (response) => sendResponse({ ok: response.ok, status: response.status, body: await response.json() }))
        .catch((error) => sendResponse({ error: error.message }));

    // keeps the channel open until sendResponse is called
    return true;
});
