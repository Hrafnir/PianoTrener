/* Version: #7 */

// === KONFIGURASJON ===
const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIN_VOLUME_THRESHOLD = 0.01; 
const WHITE_KEY_WIDTH = 40; 
const BLACK_KEY_WIDTH = 24; 

// === GLOBALE VARIABLER ===
let audioContext = null;
let analyser = null;
let mediaStreamSource = null;
let isListening = false;
let rafID = null; 
let buflen = 2048;
let buf = new Float32Array(buflen);
let currentActiveKey = null; // For mikrofon-visualisering

// Lagrer aktive oscillatorer for å kunne stoppe dem (polyfoni)
const activeOscillators = new Map(); 

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
    log("Applikasjon lastet. Klikk på pianoet for å spille, eller start mikrofonen.");
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

// === HJELPEFUNKSJON FOR AUDIO CONTEXT ===
function ensureAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    return audioContext;
}

// === PIANO GENERERING ===
function generatePiano() {
    pianoContainer.innerHTML = ''; 
    let whiteKeyCount = 0;

    for (let i = 21; i <= 108; i++) {
        const noteName = NOTE_STRINGS[i % 12];
        const octave = Math.floor(i / 12) - 1;
        const isBlack = noteName.includes('#');
        const noteId = noteName + octave; 
        
        // Beregn frekvens
        const frequency = 440 * Math.pow(2, (i - 69) / 12);

        const key = document.createElement('div');
        key.id = `key-${noteId}`;
        key.dataset.note = noteId;
        
        // Setup klasser og posisjon
        if (isBlack) {
            key.className = 'key black';
            const leftPos = (whiteKeyCount * WHITE_KEY_WIDTH) - (BLACK_KEY_WIDTH / 2);
            key.style.left = `${leftPos}px`;
        } else {
            key.className = 'key white';
            whiteKeyCount++;
        }

        // === EVENT LISTENERS FOR SPILLING ===
        // Mus
        key.addEventListener('mousedown', (e) => {
            e.preventDefault(); // Hindre tekstmarkering
            playTone(noteId, frequency);
        });
        key.addEventListener('mouseup', () => stopTone(noteId));
        key.addEventListener('mouseleave', () => stopTone(noteId));

        // Touch (for mobil/tablet) - enkel implementasjon
        key.addEventListener('touchstart', (e) => {
            e.preventDefault(); 
            playTone(noteId, frequency);
        });
        key.addEventListener('touchend', () => stopTone(noteId));

        pianoContainer.appendChild(key);
    }
    log(`Genererte piano.`);
}

function scrollToMiddle() {
    const middleC = document.getElementById('key-C4');
    if (middleC) {
        const containerWidth = document.getElementById('piano-container').clientWidth;
        const scrollPos = middleC.offsetLeft - (containerWidth / 2) + (WHITE_KEY_WIDTH / 2);
        document.getElementById('piano-container').scrollLeft = scrollPos;
    }
}

// === LYDGENERERING (SYNTH) ===
function playTone(noteId, frequency) {
    // Hvis tonen allerede spilles, ikke start på nytt (unngå "stutter")
    if (activeOscillators.has(noteId)) return;

    const ctx = ensureAudioContext();
    
    // Opprett oscillator og gain (volum)
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'triangle'; // Mykere enn 'sine' eller 'square' for piano
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);

    // Envelope (Attack)
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc.start();

    // Lagre referanser for å kunne stoppe
    activeOscillators.set(noteId, { osc, gainNode });

    // Visuell feedback
    const key = document.getElementById(`key-${noteId}`);
    if (key) key.classList.add('active');
    
    log(`Spiller: ${noteId}`);
}

function stopTone(noteId) {
    if (!activeOscillators.has(noteId)) return;

    const { osc, gainNode } = activeOscillators.get(noteId);
    const ctx = audioContext;

    // Envelope (Release) - fade ut for å unngå klikkelyd
    const releaseTime = 0.1;
    gainNode.gain.cancelScheduledValues(ctx.currentTime);
    gainNode.gain.setValueAtTime(gainNode.gain.value, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + releaseTime);

    osc.stop(ctx.currentTime + releaseTime);
    
    // Rydd opp etter fade
    setTimeout(() => {
        osc.disconnect();
        gainNode.disconnect();
    }, releaseTime * 1000 + 50);

    activeOscillators.delete(noteId);

    // Visuell feedback (fjern active, med mindre den holdes av mikrofonen... 
    // her fjerner vi den uansett for enkelhets skyld ved slipp)
    const key = document.getElementById(`key-${noteId}`);
    if (key) key.classList.remove('active');
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
    ensureAudioContext(); // Bruker samme context
    
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
        log("Mikrofon aktiv.");

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
    } else {
        const note = noteFromPitch(ac);
        const noteName = NOTE_STRINGS[note % 12];
        const octave = Math.floor(note / 12) - 1;
        const noteId = noteName + octave;
        
        displayNote.innerText = `Note: ${noteId} (${Math.round(ac)} Hz)`;
        highlightKeyFromMic(noteId);
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

// === UI OPPDATERING (MIKROFON) ===
function clearActiveKeys() {
    if (currentActiveKey) {
        currentActiveKey.classList.remove('active');
        currentActiveKey = null;
    }
}

function highlightKeyFromMic(noteId) {
    // Sjekk om noten allerede er markert (enten av mic eller klikk)
    // For å unngå flimring hvis man klikker og spiller samtidig
    const keyElement = document.getElementById(`key-${noteId}`);
    if (!keyElement) return;

    if (currentActiveKey && currentActiveKey !== keyElement) {
        currentActiveKey.classList.remove('active');
    }
    
    // Legg til active. Merk: Dette kan komme i konflikt hvis man holder musen inne,
    // men for enkelhets skyld lar vi dem dele .active klassen.
    keyElement.classList.add('active');
    currentActiveKey = keyElement;
}

/* Version: #7 */
