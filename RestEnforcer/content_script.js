// content_script.js

// CSS for the prompt
const PROMPT_STYLES = `
  #rest-enforcer-prompt-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.98);
    color: #fff;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  #rest-enforcer-prompt-container {
    background: #1a1a1a;
    padding: 2rem;
    border-radius: 12px;
    width: 400px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    border: 1px solid #333;
  }
  .re-title { margin: 0 0 1.5rem 0; font-size: 24px; text-align: center; color: #fff; }
  .re-form-group { margin-bottom: 1.5rem; }
  .re-label { display: block; margin-bottom: 0.5rem; color: #bbb; font-size: 14px; }
  .re-input { 
    width: 100%; 
    padding: 10px; 
    background: #333; 
    border: 1px solid #444; 
    border-radius: 6px; 
    color: #fff; 
    font-size: 16px; 
    box-sizing: border-box;
  }
  .re-input:focus { outline: none; border-color: #666; }
  .re-btn {
    width: 100%;
    padding: 12px;
    background: #0070f3;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 16px;
    cursor: pointer;
    font-weight: 600;
    transition: background 0.2s;
  }
  .re-btn:hover { background: #0060df; }
  .re-error { color: #ff4d4f; font-size: 14px; margin-top: 5px; display: none; }
`;

// HTML structure
const PROMPT_HTML = `
  <div id="rest-enforcer-prompt-container">
    <h2 class="re-title">Usage Intent</h2>
    <div class="re-form-group">
      <label class="re-label">What do you want to achieve?</label>
      <input type="text" id="re-intent-input" class="re-input" placeholder="e.g., Read documentation" autofocus>
    </div>
    <div class="re-form-group">
      <label class="re-label">Duration (minutes)</label>
      <input type="number" id="re-duration-input" class="re-input" placeholder="e.g., 15" min="1" max="120">
      <div id="re-error-msg" class="re-error"></div>
    </div>
    <button id="re-submit-btn" class="re-btn">Start Session</button>
  </div>
`;

function injectPrompt() {
    if (document.getElementById('rest-enforcer-prompt-overlay')) return;

    // Inject Styles
    const style = document.createElement('style');
    style.id = 'rest-enforcer-styles';
    style.textContent = PROMPT_STYLES;
    document.head.appendChild(style);

    // Inject HTML
    const overlay = document.createElement('div');
    overlay.id = 'rest-enforcer-prompt-overlay';
    overlay.innerHTML = PROMPT_HTML;
    document.body.appendChild(overlay);

    // Block original page interactions
    document.body.style.overflow = 'hidden';

    // Event Listeners
    document.getElementById('re-submit-btn').addEventListener('click', handleSubmit);
    document.getElementById('re-intent-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('re-duration-input').focus();
    });
    document.getElementById('re-duration-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSubmit();
    });
}

function removePrompt() {
    if (!document) return;
    const overlay = document.getElementById('rest-enforcer-prompt-overlay');
    const style = document.getElementById('rest-enforcer-styles');
    if (overlay) overlay.remove();
    if (style) style.remove();
    document.body.style.overflow = '';
}

function handleSubmit() {
    const intent = document.getElementById('re-intent-input').value.trim();
    const duration = parseInt(document.getElementById('re-duration-input').value);
    const errorMsg = document.getElementById('re-error-msg');

    if (!intent) {
        errorMsg.textContent = "Please enter your intent.";
        errorMsg.style.display = 'block';
        return;
    }
    if (!duration || duration <= 0) {
        errorMsg.textContent = "Please enter a valid duration.";
        errorMsg.style.display = 'block';
        return;
    }

    // specific max limit check could be added here or relied on background

    chrome.runtime.sendMessage({
        type: 'START_SESSION',
        payload: { intent, duration }
    }, (response) => {
        if (response && response.success) {
            removePrompt();
        } else {
            errorMsg.textContent = response.error || "Failed to start session.";
            errorMsg.style.display = 'block';
        }
    });
}

// Check if we are being called to remove the prompt
if (window.restEnforcerRemove) {
    removePrompt();
} else {
    injectPrompt();
}
