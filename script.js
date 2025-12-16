/* Version: #13 */

// === KONFIGURASJON ===
const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIN_VOLUME_THRESHOLD = 0.02; 
const WHITE_KEY_WIDTH = 40; 
const BLACK_KEY_WIDTH = 24; 
const MIC_STABILITY_THRESHOLD = 5; 

// Scroll config
const SCROLL_SMOOTHING = 0.05; // Lavere tall = tregere/mykere bevegelse (0.01 - 0.1)
const SCROLL_TRIGGER_MARGIN = 150; // Piksler fra kanten før vi begynner å scrolle

// === GLOBALE VARIABLER ===
let audioContext = null;
let analyser = null;
let mediaStreamSource = null;
let isListening = false;
let rafID = null; 
let buflen = 2048;
let buf = new Float32Array(buflen);
let currentActiveKey = null; 
const activeOscillators = new Map(); 

// Variables for Transcription
const activeNoteStartTimes = new Map(); // Holder styr på når hver note startet { noteId: timestamp }

// Variables for Game/Learning
let recordedSequence = [];
let isRecording = false;
let isChallenging = false;
let challengeIndex = 0;
let isPlayingSequence = false; 

// Variables for Mic Stability
let micPendingNote = null;
let micStableFrames = 0;
let lastRegisteredNote = null; 

// Variables for Smart Scroll
let targetScrollPos = 0;
let pianoContainerWidth = 0;

// === DOM ELEMENTER ===
const btnStartMic = document.getElementById('btn-start-mic');
const displayStatus = document.getElementById('status-display');
const displayNote = document.getElementById('note-display');
const logContainer = document.getElementById('app-log');
const pianoContainer = document.getElementById('piano-container');
const pianoInner = document.getElementById('piano');

// Sheet Music Elements
const sheetMusicContent = document.getElementById('sheet-music-content');
const btnClearSheet = document.getElementById('btn-clear-sheet');

// Game Controls
const btnRecord = document.getElementById('btn-record');
const btnPlaySeq = document.getElementById('btn-play-seq');
const btnChallenge = document.getElementById('btn-challenge');
const learningStatus = document.getElementById('learning-status');

// === INIT ===
window.onload = () => {
    generatePiano();
    
    // Initial scroll setup
    pianoContainerWidth = pianoContainer.clientWidth;
    scrollToMiddleImmediate(); // Start i midten
    
    // Start den myke scroll-loopen
    requestAnimationFrame(updateScrollLoop);
    
    updateButtonStates();
    log("Applikasjon lastet. Klar.");
};

// Oppdater bredde ved resize
window.onresize = () => {
    pianoContainerWidth = pianoContainer.clientWidth;
};

// === LOGGING FUNKSJON ===
function log(message) {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
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
    pianoInner.innerHTML = ''; 
    let whiteKeyCount = 0;

    for (let i = 21; i <= 108; i++) {
        const noteName = NOTE_STRINGS[i % 12];
        const octave = Math.floor(i / 12) - 1;
        const isBlack = noteName.includes('#');
        const noteId = noteName + octave; 
        const frequency = 440 * Math.pow(2, (i - 69) / 12);

        const key = document.createElement('div');
        key.id = `key-${noteId}`;
        key.dataset.note = noteId;
        
        if (isBlack) {
            key.className = 'key black';
            const leftPos = (whiteKeyCount * WHITE_KEY_WIDTH) - (BLACK_KEY_WIDTH / 2);
            key.style.left = `${leftPos}px`;
        } else {
            key.className = 'key white';
            whiteKeyCount++;
        }

        // MOUSE / TOUCH EVENTS
        key.addEventListener('mousedown', (e) => {
            e.preventDefault(); 
            handleInput(noteId, frequency, true); 
        });
        key.addEventListener('mouseup', () => stopTone(noteId));
        key.addEventListener('mouseleave', () => stopTone(noteId));

        key.addEventListener('touchstart', (e) => {
            e.preventDefault(); 
            handleInput(noteId, frequency, true);
        });
        key.addEventListener('touchend', () => stopTone(noteId));

        pianoInner.appendChild(key);
    }
}

// === SMART SCROLL LOGIC ===

function scrollToMiddleImmediate() {
    const middleC = document.getElementById('key-C4');
    if (middleC) {
        const centerPos = middleC.offsetLeft - (pianoContainerWidth / 2) + (WHITE_KEY_WIDTH / 2);
        pianoContainer.scrollLeft = centerPos;
        targetScrollPos = centerPos; // Sync target
    }
}

// Denne kjører hver frame for å gi myk bevegelse
function updateScrollLoop() {
    // 1. Sjekk om vi trenger å oppdatere target basert på aktiv nøkkel
    if (currentActiveKey) {
        const keyLeft = currentActiveKey.offsetLeft;
        const keyWidth = currentActiveKey.classList.contains('black') ? BLACK_KEY_WIDTH : WHITE_KEY_WIDTH;
        const keyCenter = keyLeft + (keyWidth / 2);
        
        // Hvor er nøkkelen i forhold til hva vi ser akkurat nå?
        const relativePos = keyCenter - pianoContainer.scrollLeft;

        // Er vi nær venstre kant?
        if (relativePos < SCROLL_TRIGGER_MARGIN) {
            // Mål: Sentrer nøkkelen
            targetScrollPos = keyCenter - (pianoContainerWidth / 2);
        }
        // Er vi nær høyre kant?
        else if (relativePos > (pianoContainerWidth - SCROLL_TRIGGER_MARGIN)) {
            // Mål: Sentrer nøkkelen
            targetScrollPos = keyCenter - (pianoContainerWidth / 2);
        }
    }

    // 2. Utfør selve bevegelsen (Linear Interpolation)
    // Sjekk diff
    const currentScroll = pianoContainer.scrollLeft;
    const diff = targetScrollPos - currentScroll;

    // Hvis diffen er stor nok til å bry seg om
    if (Math.abs(diff) > 1) {
        // Flytt 5% av avstanden (SCROLL_SMOOTHING) per frame
        pianoContainer.scrollLeft = currentScroll + (diff * SCROLL_SMOOTHING);
    }

    requestAnimationFrame(updateScrollLoop);
}


// === SHEET MUSIC / TRANSKRIPSJON ===

function recordNoteStart(noteId) {
    // Hvis noten allerede er aktiv (f.eks. ved raske trykk), oppdaterer vi ikke starttiden
    // slik at vi får én lang blokk i stedet for flimring, eller vi avslutter forrige?
    // La oss si: Nytt trykk = ny note.
    if (activeNoteStartTimes.has(noteId)) {
        // Avslutt forrige før vi starter ny (sikkerhetsnett)
        recordNoteEnd(noteId); 
    }
    activeNoteStartTimes.set(noteId, Date.now());
}

function recordNoteEnd(noteId) {
    if (!activeNoteStartTimes.has(noteId)) return;

    const startTime = activeNoteStartTimes.get(noteId);
    const endTime = Date.now();
    const duration = endTime - startTime;
    activeNoteStartTimes.delete(noteId);

    // Filterer ut ekstremt korte "glitch" trykk (under 50ms)
    if (duration < 50) return;

    createNoteBlock(noteId, duration);
}

function createNoteBlock(noteId, duration) {
    const block = document.createElement('div');
    block.className = 'note-block';
    block.innerText = noteId;
    
    // Beregn bredde. F.eks. 100ms = 20px. 
    // Juster faktor (0.2) etter hvor raskt "papiret" skal gå
    let width = duration * 0.1; 
    if (width < 30) width = 30; // Minste bredde for lesbarhet
    
    block.style.width = `${width}px`;

    // Fargekode basert på om det er svart/hvit tangent? Eller bare en standard farge.
    // Vi bruker CSS standard, men kan legge til custom style hvis ønskelig.
    
    sheetMusicContent.appendChild(block);
    
    // Auto-scroll notearket til slutten
    const scrollArea = document.getElementById('sheet-music-scroll');
    scrollArea.scrollLeft = scrollArea.scrollWidth;
}

// Tøm noteark
btnClearSheet.addEventListener('click', () => {
    sheetMusicContent.innerHTML = '';
    log("Noteark tømt.");
});


// === GAME LOGIC & INPUT HANDLING ===

function handleInput(noteId, frequency, isClick) {
    if (isClick) {
        playTone(noteId, frequency);
    }

    // Spill-logikk
    if (isRecording) {
        recordedSequence.push(noteId);
        log(`Tatt opp: ${noteId}`);
        learningStatus.innerText = `Tar opp... Antall noter: ${recordedSequence.length}`;
        updateButtonStates();
    } 
    else if (isChallenging) {
        checkPlayerInput(noteId);
    }
}

function checkPlayerInput(noteId) {
    if (challengeIndex >= recordedSequence.length) return; 

    const expectedNote = recordedSequence[challengeIndex];
    const keyElement = document.getElementById(`key-${noteId}`);

    if (noteId === expectedNote) {
        log(`Riktig! (${noteId})`);
        challengeIndex++;
        
        if (keyElement) {
            keyElement.classList.add('correct');
            setTimeout(() => keyElement.classList.remove('correct'), 300);
        }

        if (challengeIndex >= recordedSequence.length) {
            learningStatus.innerText = "🏆 HURRA! Du klarte det!";
            log("Utfordring fullført!");
            isChallenging = false;
            updateButtonStates();
        } else {
            learningStatus.innerText = `Riktig! Neste note: ${challengeIndex + 1} av ${recordedSequence.length}`;
        }

    } else {
        log(`Feil note. Spilte ${noteId}, ventet ${expectedNote}`);
        if (keyElement) {
            keyElement.classList.add('wrong');
            setTimeout(() => keyElement.classList.remove('wrong'), 300);
        }
        learningStatus.innerText = "Feil tone, prøv igjen!";
    }
}

// === BUTTON EVENTS ===

btnRecord.addEventListener('click', () => {
    if (isRecording) {
        isRecording = false;
        learningStatus.innerText = `Opptak ferdig. ${recordedSequence.length} noter lagret.`;
        log("Stoppet opptak.");
    } else {
        recordedSequence = [];
        isRecording = true;
        isChallenging = false; 
        learningStatus.innerText = "🔴 TAR OPP! Spill noter nå...";
        log("Startet opptak.");
    }
    updateButtonStates();
});

btnPlaySeq.addEventListener('click', async () => {
    if (recordedSequence.length === 0) return;
    
    isPlayingSequence = true;
    updateButtonStates();
    learningStatus.innerText = "Spiller fasit...";
    log("Spiller av lagret sekvens...");

    for (let i = 0; i < recordedSequence.length; i++) {
        const noteId = recordedSequence[i];
        await playDemoNote(noteId);
        await new Promise(r => setTimeout(r, 100)); 
    }

    isPlayingSequence = false;
    learningStatus.innerText = "Ferdig spilt. Din tur?";
    log("Avspilling ferdig.");
    updateButtonStates();
});

btnChallenge.addEventListener('click', () => {
    if (recordedSequence.length === 0) return;
    isChallenging = true;
    isRecording = false;
    challengeIndex = 0;
    learningStatus.innerText = "🎮 PRØV SELV! Spill første tone...";
    log("Startet utfordring.");
    updateButtonStates();
});

function updateButtonStates() {
    btnRecord.innerText = isRecording ? "⏹ Stopp Opptak" : "⏺ Start Opptak (Simon)";
    btnRecord.classList.toggle('active', isRecording);

    btnRecord.disabled = isPlayingSequence || isChallenging;
    btnPlaySeq.disabled = isRecording || isPlayingSequence || isChallenging || recordedSequence.length === 0;
    btnChallenge.disabled = isRecording || isPlayingSequence || isChallenging || recordedSequence.length === 0;
}

// === LYDGENERERING (SYNTH) ===

function playTone(noteId, frequency) {
    if (activeOscillators.has(noteId)) return;
    const ctx = ensureAudioContext();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);

    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start();

    activeOscillators.set(noteId, { osc, gainNode });

    const key = document.getElementById(`key-${noteId}`);
    if (key) key.classList.add('active');
    
    // TRANSKRIPSJON START
    recordNoteStart(noteId);
}

function stopTone(noteId) {
    // TRANSKRIPSJON STOP
    recordNoteEnd(noteId);

    if (!activeOscillators.has(noteId)) return;
    const { osc, gainNode } = activeOscillators.get(noteId);
    const ctx = audioContext;

    const releaseTime = 0.1;
    gainNode.gain.cancelScheduledValues(ctx.currentTime);
    gainNode.gain.setValueAtTime(gainNode.gain.value, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + releaseTime);

    osc.stop(ctx.currentTime + releaseTime);
    
    setTimeout(() => {
        osc.disconnect();
        gainNode.disconnect();
    }, releaseTime * 1000 + 50);

    activeOscillators.delete(noteId);

    const key = document.getElementById(`key-${noteId}`);
    if (key && !isPlayingSequence) key.classList.remove('active');
}

function playDemoNote(noteId) {
    return new Promise(resolve => {
        const regex = /([A-G]#?)(-?\d+)/;
        const match = noteId.match(regex);
        if (!match) { resolve(); return; }

        const noteName = match[1];
        const octave = parseInt(match[2]);
        const noteIndex = NOTE_STRINGS.indexOf(noteName);
        const midi = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midi - 69) / 12);

        // TRANSKRIPSJON FOR DEMO (Valgfritt, kommenter ut recordNoteStart/End hvis du ikke vil ha fasit på arket)
        recordNoteStart(noteId);

        const ctx = ensureAudioContext();
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gainNode.gain.setValueAtTime(0.5, ctx.currentTime); 
        
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start();

        const key = document.getElementById(`key-${noteId}`);
        if (key) key.classList.add('active');

        // Sett global aktiv key for at scrollen skal følge med på demoen også!
        currentActiveKey = key;

        setTimeout(() => {
            gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
            osc.stop(ctx.currentTime + 0.1);
            if (key) key.classList.remove('active');
            
            // TRANSKRIPSJON SLUTT FOR DEMO
            recordNoteEnd(noteId);
            
            resolve();
        }, 500); // Demo varighet 500ms
    });
}

// === MIKROFON HÅNDTERING ===
btnStartMic.addEventListener('click', toggleMicrophone);

function toggleMicrophone() {
    if (isListening) {
        isListening = false;
        btnStartMic.innerText = "Start Mikrofon / Lyd";
        cancelAnimationFrame(rafID);
        displayStatus.innerText = "Status: Pauset";
        micPendingNote = null;
        lastRegisteredNote = null;
        const keys = document.querySelectorAll('.key');
        keys.forEach(k => k.classList.remove('active'));
        currentActiveKey = null; // Stopp scroll
    } else {
        startPitchDetect();
    }
}

function startPitchDetect() {
    ensureAudioContext(); 
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
        log("FEIL: Mikrofon " + err);
        displayStatus.innerText = "Status: Feil";
    });
}

function updatePitch() {
    if (!isListening) return;

    analyser.getFloatTimeDomainData(buf);
    const ac = autoCorrelate(buf, audioContext.sampleRate);

    if (ac === -1) {
        micStableFrames = 0;
        micPendingNote = null;
        if (currentActiveKey && !activeOscillators.size) { 
            // Fjern visuell markering ved stillhet (hvis ikke brukeren klikker med musa)
            currentActiveKey.classList.remove('active');
            currentActiveKey = null;
        }
        // Vi bør kanskje kalle recordNoteEnd her hvis mic ble stille?
        // Siden vi ikke har noteId her enkelt tilgjengelig, er det litt tricky.
        // Løsning: Lagre lastVisualizedNote og stopp den.
        if (lastRegisteredNote) {
            recordNoteEnd(lastRegisteredNote);
            lastRegisteredNote = null;
        }

    } else {
        const note = noteFromPitch(ac);
        const noteName = NOTE_STRINGS[note % 12];
        const octave = Math.floor(note / 12) - 1;
        const noteId = noteName + octave;
        
        displayNote.innerText = `Note: ${noteId} (${Math.round(ac)} Hz)`;
        
        if (noteId === micPendingNote) {
            micStableFrames++;
        } else {
            micPendingNote = noteId;
            micStableFrames = 0;
        }

        // Visuelt og Transkripsjon via mic
        const keyElement = document.getElementById(`key-${noteId}`);
        if (keyElement) {
            
            // Oppdater Active Key for Scroll og Highlight
            if (currentActiveKey && currentActiveKey !== keyElement) {
                currentActiveKey.classList.remove('active');
                // Hvis noten byttet, avslutt forrige for transkripsjon
                if (lastRegisteredNote && lastRegisteredNote !== noteId) {
                    recordNoteEnd(lastRegisteredNote);
                }
            }
            keyElement.classList.add('active');
            currentActiveKey = keyElement;

            // Transkripsjon start (kun hvis vi ikke allerede tracker denne noten)
            if (!activeNoteStartTimes.has(noteId)) {
                recordNoteStart(noteId);
                lastRegisteredNote = noteId;
            }
        }

        // Spillinput (krever mer stabilitet)
        if (micStableFrames > MIC_STABILITY_THRESHOLD) {
             // Logic handled above mostly, input trigger could be separate
             if (noteId !== lastRegisteredNote) {
                 // Denne blokken kjører kun ved *endring* etter stabil tone
                 handleInput(noteId, ac, false); 
             }
        }
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

/* Version: #13 */
