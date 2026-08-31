// Initialize UI and State
let currentTab = 'pseudocode';
let codeEditor;
let pyodide;
let editor; // Drawflow instance

document.addEventListener('DOMContentLoaded', async () => {
    // Setup Tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            currentTab = btn.getAttribute('data-tab');
            document.getElementById(currentTab).classList.add('active');
        });
    });

    // Setup CodeMirror
    codeEditor = CodeMirror.fromTextArea(document.getElementById('python-code'), {
        mode: 'python',
        theme: 'material-ocean',
        lineNumbers: true,
        indentUnit: 4,
        matchBrackets: true
    });
    codeEditor.setSize("100%", "100%");

    // Setup Text Selection for Explanation
    codeEditor.on("cursorActivity", () => {
        const selection = codeEditor.getSelection();
        const tooltip = document.getElementById('explain-tooltip');
        
        if (selection.trim().length > 0) {
            const cursorCoords = codeEditor.cursorCoords(true, "local");
            tooltip.style.display = 'block';
            tooltip.style.top = (cursorCoords.top - 40) + 'px';
            tooltip.style.left = cursorCoords.left + 'px';
        } else {
            tooltip.style.display = 'none';
        }
    });

    // Setup Drawflow
    const id = document.getElementById("drawflow");
    editor = new Drawflow(id);
    editor.reroute = true;
    editor.start();

    // Init Pyodide
    try {
        pyodide = await loadPyodide();
        const runBtn = document.getElementById('run-btn');
        document.getElementById('run-btn-text').textContent = 'Run Code';
        runBtn.disabled = false;
        
        // Setup stdout redirection
        await pyodide.runPythonAsync(`
import sys
import io
class JSOutput(io.StringIO):
    def write(self, string):
        import js
        js.appendOutput(string)
        return len(string)
sys.stdout = JSOutput()
sys.stderr = JSOutput()
        `);
    } catch (e) {
        console.error("Pyodide failed to load", e);
        document.getElementById('run-btn-text').textContent = 'Engine Load Failed';
    }
    // Event Listeners
    document.getElementById('convert-btn').addEventListener('click', convertToPython);
    document.getElementById('run-btn').addEventListener('click', runPython);
    document.getElementById('explain-btn').addEventListener('click', explainSelectedCode);
    
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', hideModal);
    });
    document.getElementById('explanation-modal').addEventListener('click', (e) => {
        if(e.target === document.getElementById('explanation-modal')) hideModal();
    });
});

window.appendOutput = function(text) {
    const out = document.getElementById('output-console');
    out.textContent += text;
    out.scrollTop = out.scrollHeight;
};

// Drag and Drop for Flowchart
function drag(ev) {
    ev.dataTransfer.setData("node", ev.target.getAttribute("data-node"));
}

function drop(ev) {
    ev.preventDefault();
    var type = ev.dataTransfer.getData("node");
    addNodeToDrawFlow(type, ev.clientX, ev.clientY);
}

function allowDrop(ev) {
    ev.preventDefault();
}

function addNodeToDrawFlow(name, pos_x, pos_y) {
    if(editor.editor_mode === 'fixed') return false;
    
    pos_x = pos_x * ( editor.precanvas.clientWidth / (editor.precanvas.clientWidth * editor.zoom)) - (editor.precanvas.getBoundingClientRect().x * ( editor.precanvas.clientWidth / (editor.precanvas.clientWidth * editor.zoom)));
    pos_y = pos_y * ( editor.precanvas.clientHeight / (editor.precanvas.clientHeight * editor.zoom)) - (editor.precanvas.getBoundingClientRect().y * ( editor.precanvas.clientHeight / (editor.precanvas.clientHeight * editor.zoom)));
    
    let html = '';
    switch(name) {
        case 'start':
            html = `<div><div class="title-box">Start/End</div><div class="box"><input type="text" placeholder="e.g. Start" df-text></div></div>`;
            editor.addNode('start', 0, 1, pos_x, pos_y, 'start', {text: ''}, html);
            break;
        case 'process':
            html = `<div><div class="title-box">Process</div><div class="box"><textarea df-text placeholder="e.g. x = 5" style="height:40px;"></textarea></div></div>`;
            editor.addNode('process', 1, 1, pos_x, pos_y, 'process', {text: ''}, html);
            break;
        case 'decision':
            html = `<div><div class="title-box">Decision</div><div class="box"><input type="text" placeholder="e.g. x > 5" df-text></div></div>`;
            editor.addNode('decision', 1, 2, pos_x, pos_y, 'decision', {text: ''}, html);
            break;
        case 'io':
            html = `<div><div class="title-box">Input/Output</div><div class="box"><input type="text" placeholder="e.g. Print x" df-text></div></div>`;
            editor.addNode('io', 1, 1, pos_x, pos_y, 'io', {text: ''}, html);
            break;
    }
}

// SECURE Backend LLM Call
async function callAI(promptText) {
    const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt: promptText })
    });

    const data = await response.json();
    
    if (!response.ok) {
        throw new Error(data.error || "Unknown error occurred");
    }

    return data.text || "No response generated.";
}

// Convert to Python
async function convertToPython() {
    let inputData = "";
    let promptPrefix = "";
    
    if (currentTab === 'pseudocode') {
        inputData = document.getElementById('pseudocode-input').value;
        promptPrefix = "Convert the following pseudocode to a complete, runnable Python program. Do not include markdown formatting or explanations, just output the raw Python code:\n\n";
    } else if (currentTab === 'algorithm') {
        inputData = document.getElementById('algorithm-input').value;
        promptPrefix = "Convert the following step-by-step algorithm to a complete, runnable Python program. Do not include markdown formatting or explanations, just output the raw Python code:\n\n";
    } else if (currentTab === 'flowchart') {
        const exportdata = editor.export();
        inputData = JSON.stringify(exportdata, null, 2);
        promptPrefix = "I have a flowchart exported as JSON. Convert its logic into a complete, runnable Python program. The nodes include start, process, decision, and io. Connect the logic based on inputs/outputs of nodes. Do not include markdown formatting or explanations, just output the raw Python code:\n\n";
    }

    if (!inputData.trim() || inputData === '{}' || inputData.length < 20 && currentTab === 'flowchart') {
        alert("Please provide some input before converting.");
        return;
    }

    const prompt = promptPrefix + inputData;
    
    const indicator = document.getElementById('loading-indicator');
    const btn = document.getElementById('convert-btn');
    indicator.classList.remove('hidden');
    indicator.classList.add('flex');
    btn.disabled = true;
    btn.classList.add('opacity-50');
    
    try {
        let code = await callAI(prompt);
        // Clean up markdown block if present
        code = code.replace(/```python/g, '').replace(/```/g, '').trim();
        codeEditor.setValue(code);
    } catch (e) {
        showModal(e.message, "Synthesis Error");
    } finally {
        indicator.classList.add('hidden');
        indicator.classList.remove('flex');
        btn.disabled = false;
        btn.classList.remove('opacity-50');
    }
}

// Run Python Code
async function runPython() {
    const code = codeEditor.getValue();
    const out = document.getElementById('output-console');
    out.textContent = ""; // clear
    
    try {
        await pyodide.runPythonAsync(code);
    } catch (err) {
        out.textContent += "\nError: " + err.toString();
        explainError(code, err.toString());
    }
}

// Explain Error
async function explainError(code, errorMsg) {
    const prompt = `I ran the following Python code:\n\n${code}\n\nAnd got this error:\n\n${errorMsg}\n\nPlease explain what this error means and how to fix it in simple terms. Format your response in markdown.`;
    showModal("Analyzing Error...", "Runtime Exception Analysis");
    try {
        const response = await callAI(prompt);
        showModal(response, "Runtime Exception Analysis");
    } catch (e) {
        showModal("Failed to get explanation: " + e.message, "Error");
    }
}

// Explain Selected Code
async function explainSelectedCode() {
    const selection = codeEditor.getSelection();
    if (!selection) return;
    
    const fullCode = codeEditor.getValue();
    const prompt = `Here is a Python program:\n\n${fullCode}\n\nPlease explain what the following selected section does and why it is written this way:\n\n${selection}\n\nFormat your response in markdown.`;
    
    document.getElementById('explain-tooltip').style.display = 'none';
    showModal("Analyzing code architecture...", "Code Intelligence");
    
    try {
        const response = await callAI(prompt);
        showModal(response, "Code Intelligence");
    } catch (e) {
        showModal("Failed to get explanation: " + e.message, "Error");
    }
}

function showModal(content, title = "AI Analysis") {
    const modal = document.getElementById('explanation-modal');
    const container = document.getElementById('modal-container');
    document.getElementById('modal-title').textContent = title;
    
    if (typeof marked !== 'undefined') {
        document.getElementById('explanation-content').innerHTML = marked.parse(content);
    } else {
        document.getElementById('explanation-content').innerText = content;
    }
    
    modal.classList.remove('hidden');
    // small delay for transition
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        container.classList.remove('scale-95');
    }, 10);
}

function hideModal() {
    const modal = document.getElementById('explanation-modal');
    const container = document.getElementById('modal-container');
    
    modal.classList.add('opacity-0');
    container.classList.add('scale-95');
    
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}
