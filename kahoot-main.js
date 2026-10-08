// Runs in the page's own JavaScript world (see "world" in manifest.json), which is the only place
// where the handlers React attached to the answer buttons can be reached.
// kahoot.js asks for an answer to be pressed with a 'kahoot-shortcuts-press' event on its button.
document.addEventListener('kahoot-shortcuts-press', (event) => {
    const button = event.target;
    const propsKey = Object.keys(button).find(key => key.startsWith('__reactProps$'));
    const onClick = propsKey === undefined ? undefined : button[propsKey].onClick;

    if (typeof onClick !== 'function') {
        console.error('[Kahoot AI]', 'no click handler found on the answer button', button);
        return;
    }

    // Kahoot's handler only accepts events flagged as coming from the user
    onClick({
        type: 'click',
        isTrusted: true,
        target: button,
        currentTarget: button,
        preventDefault() {},
        stopPropagation() {}
    });
});
