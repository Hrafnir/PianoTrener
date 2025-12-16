/* Version: #5 */

// === KONFIGURASJON ===
const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIN_VOLUME_THRESHOLD = 0.01; 
const WHITE_KEY_WIDTH = 40; // Må matche CSS
const BLACK_KEY_WIDTH = 24; // Må matche CSS

// === GLOBALE VARIABLER ===
let audioContext = null;
let analyser = null;
let mediaStreamSource = null;
let isListening = false;
let rafID = null; 
let buflen = 2048;
let buf = new Float32Array(buflen);
let currentActiveKey = null;

// === DOM ELEMENTER ===
const btnStartMic = document.getElementById('btn-start-mic');
const displayStatus = document.getElementById('status-display');
const displayNote = document.getElementById('note-display');
const logContainer = document.getElementById('app-log');
const pianoContainer = document.getElementById('piano');

// === INIT ===
window.onload = () => {
    generatePiano();
    scrollToMiddle();
    log("Applikasjon lastet. Piano generert (88 tangenter).");
};

// === LOGGING FUNKSJON ===
function log(message) {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
    console.log(`[PianoLog] ${message}`);
}

// === PIANO GENERERING ===
function generatePiano() {
    pianoContainer.innerHTML = ''; // Tøm container for sikkerhets skyld
    let whiteKeyCount = 0;

    // MIDI noter for standard 88-tangenters piano:
    // A0 er MIDI 21, C8 er MIDI 108
    for (let i = 21; i <= 108; i++) {
        const noteName = NOTE_STRINGS[i % 12];
        const octave = Math.floor(i / 12) - 1;
        const isBlack = noteName.includes('#');
        const noteId = noteName + octave; // Eks: "C#4"

        const key = document.createElement('div');
        key.id = `key-${noteId}`;
        key.dataset.note = noteId;
        
        if (isBlack) {
            key.className = 'key black';
            // Beregn posisjon: Plasseres på grensen etter forrige hvite tangent
            // Sentrert over linjen: (Antall hvite * bredde) - (svart bredde / 2)
            const leftPos = (whiteKeyCount * WHITE_KEY_WIDTH) - (BLACK_KEY_WIDTH / 2);
            key.style.left = `${leftPos}px`;
        } else {
            key.className = 'key white';
            whiteKeyCount++;
        }

        pianoContainer.appendChild(key);
    }
    log(`Genererte ${whiteKeyCount} hvite tangenter og totalt ${108-21+1} tangenter.`);
}

function scrollToMiddle() {
    // Scroll til C4 (Middle C)
    const middleC = document.getElementById('key-C4');
    if (middleC) {
        // Finn posisjonen til C4 i containeren
        const containerWidth = document.getElementById('piano-container').clientWidth;
        const scrollPos = middleC.offsetLeft - (containerWidth / 2) + (WHITE_KEY_WIDTH / 2);
        
        document.getElementById('piano-container').scrollLeft = scrollPos;
    }
}

// === EVENT LISTENERS ===
btnStartMic.addEventListener('click', toggleMicrophone);

// === MIKROFON HÅNDTERING ===
function toggleMicrophone() {
    if (isListening) {
        log("Stanser lytting.");
        isListening = false;
        btnStartMic.innerText = "Start Mikrofon / Lyd";
        cancelAnimationFrame(rafID);
        displayStatus.innerText = "Status: Pauset";
        clearActiveKeys();
    } else {
        startPitchDetect();
    }
}

function startPitchDetect() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    navigator.mediaDevices.getUserMedia({
        "audio": {
            "echoCancellation": true,
            "autoGainControl": false,
            "noiseSuppression": false
        }
    }).then((stream) => {
        isListening = true;
        btnStartMic.innerText = "Stopp Mikrofon";
        displayStatus.innerText = "Status: Lytter...";
        log("Mikrofon aktiv. AudioContext kjører.");

        mediaStreamSource = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        mediaStreamSource.connect(analyser);

        updatePitch();
    }).catch((err) => {
        log("FEIL: Kunne ikke få tilgang til mikrofon. " + err);
        displayStatus.innerText = "Status: Feil (Se logg)";
    });
}

// === HOVEDLOOP (Pitch Detection) ===
function updatePitch() {
    if (!isListening) return;

    analyser.getFloatTimeDomainData(buf);
    const ac = autoCorrelate(buf, audioContext.sampleRate);

    if (ac === -1) {
        // Ingen tydelig tone
        // Vi kan velge å fjerne markering her hvis vi vil ha rask respons
        // clearActiveKeys(); 
    } else {
        const note = noteFromPitch(ac);
        const noteName = NOTE_STRINGS[note % 12];
        const octave = Math.floor(note / 12) - 1;
        const noteId = noteName + octave;
        
        displayNote.innerText = `Note: ${noteId} (${Math.round(ac)} Hz)`;
        highlightKey(noteId);
    }

    rafID = window.requestAnimationFrame(updatePitch);
}

// === MATEMATIKK (Auto-korrelasjon) ===
function autoCorrelate(buf, sampleRate) {
    let size = buf.length;
    let rms = 0;
    for (let i = 0; i < size; i++) {
        const val = buf[i];
        rms += val * val;
    }
    rms = Math.sqrt(rms / size);

    if (rms < MIN_VOLUME_THRESHOLD) return -1;

    let r1 = 0, r2 = size - 1, thres = 0.2;
    for (let i = 0; i < size / 2; i++) {
        if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    }
    for (let i = 1; i < size / 2; i++) {
        if (Math.abs(buf[size - i]) < thres) { r2 = size - i; break; }
    }

    buf = buf.slice(r1, r2);
    size = buf.length;

    const c = new Array(size).fill(0);
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size - i; j++) {
            c[i] = c[i] + buf[j] * buf[j + i];
        }
    }

    let d = 0;
    while (c[d] > c[d + 1]) d++;
    
    let maxval = -1, maxpos = -1;
    for (let i = d; i < size; i++) {
        if (c[i] > maxval) {
            maxval = c[i];
            maxpos = i;
        }
    }
    
    let T0 = maxpos;

    const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);

    return sampleRate / T0;
}

function noteFromPitch(frequency) {
    const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
    return Math.round(noteNum) + 69;
}

// === UI OPPDATERING ===
function clearActiveKeys() {
    if (currentActiveKey) {
        currentActiveKey.classList.remove('active');
        currentActiveKey = null;
    }
}

function highlightKey(noteId) {
    if (currentActiveKey && currentActiveKey.id === `key-${noteId}`) {
        return; 
    }
    clearActiveKeys();

    const keyElement = document.getElementById(`key-${noteId}`);
    if (keyElement) {
        keyElement.classList.add('active');
        currentActiveKey = keyElement;
        
        // Valgfritt: Scroll til noten hvis den er utenfor skjermen (kan bli urolig, så vi dropper det for nå)
    }
}

/* Version: #5 */
