/* Version: #10 */

// === KONFIGURASJON ===
const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIN_VOLUME_THRESHOLD = 0.02; // Litt høyere for å unngå bakgrunnsstøy
const WHITE_KEY_WIDTH = 40; 
const BLACK_KEY_WIDTH = 24; 
const MIC_STABILITY_THRESHOLD = 5; // Hvor mange frames samme note må holdes for å registreres via mic

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

// === STATE VARIABLES FOR GAME/LEARNING ===
let recordedSequence = [];
let isRecording = false;
let isChallenging = false;
let challengeIndex = 0;
let isPlayingSequence = false; // Når datamaskinen spiller fasit

// Variabler for mic-stabilitet
let micPendingNote = null;
let micStableFrames = 0;
let lastRegisteredNote = null; // Siste note sendt til spill-logikken

// === DOM ELEMENTER ===
const btnStartMic = document.getElementById('btn-start-mic');
const displayStatus = document.getElementById('status-display');
const displayNote = document.getElementById('note-display');
const logContainer = document.getElementById('app-log');
const pianoContainer = document.getElementById('piano');

// Game Controls
const btnRecord = document.getElementById('btn-record');
const btnPlaySeq = document.getElementById('btn-play-seq');
const btnChallenge = document.getElementById('btn-challenge');
const learningStatus = document.getElementById('learning-status');

// === INIT ===
window.onload = () => {
    generatePiano();
    scrollToMiddle();
    updateButtonStates();
    log("Applikasjon lastet. Klar.");
};

// === LOGGING FUNKSJON ===
function log(message) {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
    // console.log(`[PianoLog] ${message}`);
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
            handleInput(noteId, frequency, true); // True = input fra bruker
        });
        key.addEventListener('mouseup', () => stopTone(noteId));
        key.addEventListener('mouseleave', () => stopTone(noteId));

        key.addEventListener('touchstart', (e) => {
            e.preventDefault(); 
            handleInput(noteId, frequency, true);
        });
        key.addEventListener('touchend', () => stopTone(noteId));

        pianoContainer.appendChild(key);
    }
}

function scrollToMiddle() {
    const middleC = document.getElementById('key-C4');
    if (middleC) {
        const containerWidth = document.getElementById('piano-container').clientWidth;
        const scrollPos = middleC.offsetLeft - (containerWidth / 2) + (WHITE_KEY_WIDTH / 2);
        document.getElementById('piano-container').scrollLeft = scrollPos;
    }
}

// === GAME LOGIC & INPUT HANDLING ===

// Sentral funksjon som kalles enten man klikker eller mic detekterer en tone
function handleInput(noteId, frequency, isClick) {
    // 1. Spill lyd (hvis klikk, mic lager lyden selv)
    if (isClick) {
        playTone(noteId, frequency);
    } else {
        // Hvis mic, bare visuelt (highlightKey håndteres av updatePitch, men vi trenger game logic)
    }

    // 2. Game Logic
    if (isRecording) {
        recordedSequence.push(noteId);
        log(`Tatt opp: ${noteId} (Totalt: ${recordedSequence.length})`);
        learningStatus.innerText = `Tar opp... Antall noter: ${recordedSequence.length}`;
        updateButtonStates();
    } 
    else if (isChallenging) {
        checkPlayerInput(noteId);
    }
}

function checkPlayerInput(noteId) {
    if (challengeIndex >= recordedSequence.length) return; // Ferdig

    const expectedNote = recordedSequence[challengeIndex];
    const keyElement = document.getElementById(`key-${noteId}`);

    if (noteId === expectedNote) {
        // RIKTIG
        log(`Riktig! (${noteId})`);
        challengeIndex++;
        
        // Visuell feedback (Grønn)
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
        // FEIL
        log(`Feil note. Du spilte ${noteId}, ventet ${expectedNote}`);
        // Visuell feedback (Rød)
        if (keyElement) {
            keyElement.classList.add('wrong');
            setTimeout(() => keyElement.classList.remove('wrong'), 300);
        }
        learningStatus.innerText = "Feil tone, prøv igjen!";
    }
}

// === BUTTON EVENT LISTENERS ===

btnRecord.addEventListener('click', () => {
    if (isRecording) {
        // Stopp opptak
        isRecording = false;
        learningStatus.innerText = `Opptak ferdig. ${recordedSequence.length} noter lagret.`;
        log("Stoppet opptak.");
    } else {
        // Start opptak
        recordedSequence = [];
        isRecording = true;
        isChallenging = false; // Avbryt evt spill
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

    // Spill av sekvensen
    for (let i = 0; i < recordedSequence.length; i++) {
        const noteId = recordedSequence[i];
        
        // Finn frekvens (trengs for playTone)
        // Vi kan jukse og regne den ut, eller lagre den. Regner ut:
        // Men playTone trenger frekvens. La oss finne elementet og simulere.
        // Eller enklere: Vi lager en demo-lyd funksjon.
        
        // Vi må finne frekvensen basert på navnet for å bruke synth
        // Enklest: Vi bruker playTone, men må vite Hz. 
        // Vi kan hente Hz fra noteFromPitch logikken baklengs, eller bare hardkode Hz i generatePiano?
        // La oss gjøre det enkelt: Vi vet ikke Hz her uten å regne.
        // Quick fix: Finn key element og bruk en standard lyd eller regn ut.
        // Vi implementerte formelen i generatePiano: 440 * Math.pow(2, (i - 69) / 12)
        // Men vi har ikke 'i'.
        // Løsning: playToneDemo som tar noteId og bruker oscillator.
        
        await playDemoNote(noteId);
        await new Promise(r => setTimeout(r, 100)); // Pause mellom noter
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
    // Record Button text
    btnRecord.innerText = isRecording ? "⏹ Stopp Opptak" : "⏺ Start Opptak";
    btnRecord.classList.toggle('active', isRecording);

    // Disable buttons during action
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
}

function stopTone(noteId) {
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
    // Fjern active KUN hvis vi ikke spiller av en demo-sekvens (som styrer lyset selv)
    // Men for manuell spilling er dette ok.
    if (key && !isPlayingSequence) key.classList.remove('active');
}

// Funksjon for å spille av en note (for fasit-avspilling)
function playDemoNote(noteId) {
    return new Promise(resolve => {
        // Vi må finne frekvens. Vi jukser og bruker en map eller regner ut på nytt?
        // La oss søke opp elementet og se om vi lagret frekvens? Nei.
        // La oss regne ut fra ID.
        // ID: C4. Note: C, Octave: 4.
        const regex = /([A-G]#?)(-?\d+)/;
        const match = noteId.match(regex);
        if (!match) { resolve(); return; }

        const noteName = match[1];
        const octave = parseInt(match[2]);
        const noteIndex = NOTE_STRINGS.indexOf(noteName);
        // MIDI note calculation: (octave + 1) * 12 + noteIndex
        const midi = (octave + 1) * 12 + noteIndex;
        const freq = 440 * Math.pow(2, (midi - 69) / 12);

        // Spill
        const ctx = ensureAudioContext();
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gainNode.gain.setValueAtTime(0.5, ctx.currentTime); // Instant attack
        
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start();

        // Visuelt
        const key = document.getElementById(`key-${noteId}`);
        if (key) key.classList.add('active');

        // Stopp etter 500ms
        setTimeout(() => {
            gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
            osc.stop(ctx.currentTime + 0.1);
            if (key) key.classList.remove('active');
            resolve();
        }, 500);
    });
}

// === MIKROFON HÅNDTERING (Med Stabilitetssjekk) ===
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
        // Stillhet / Ingen tone
        micStableFrames = 0;
        micPendingNote = null;
        
        // Fjern visuell markering umiddelbart ved stillhet? 
        // Kan føre til blinking. Vi lar den stå bittelitt eller fjerner hvis "active" er fra mic.
        if (currentActiveKey) {
            currentActiveKey.classList.remove('active');
            currentActiveKey = null;
        }
    } else {
        const note = noteFromPitch(ac);
        const noteName = NOTE_STRINGS[note % 12];
        const octave = Math.floor(note / 12) - 1;
        const noteId = noteName + octave;
        
        displayNote.innerText = `Note: ${noteId} (${Math.round(ac)} Hz)`;
        
        // --- STABILITETSSJEKK FOR SPILL-INPUT ---
        if (noteId === micPendingNote) {
            micStableFrames++;
        } else {
            micPendingNote = noteId;
            micStableFrames = 0;
        }

        // Visuell feedback (Alltid oppdater visuelt selv om ikke "stabilt" nok for spillregistrering ennå)
        // For å gjøre det responsivt visuelt:
        highlightKeyFromMic(noteId);

        // Registrer som input i spillet HVIS stabil nok OG ny tone
        if (micStableFrames > MIC_STABILITY_THRESHOLD) {
            if (noteId !== lastRegisteredNote) {
                // Vi har en ny, stabil tone!
                log(`Mic Input: ${noteId}`);
                handleInput(noteId, ac, false); // False = input fra mic (ikke klikk)
                lastRegisteredNote = noteId;
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

function highlightKeyFromMic(noteId) {
    const keyElement = document.getElementById(`key-${noteId}`);
    if (!keyElement) return;

    if (currentActiveKey && currentActiveKey !== keyElement) {
        currentActiveKey.classList.remove('active');
    }
    keyElement.classList.add('active');
    currentActiveKey = keyElement;
}

/* Version: #10 */
