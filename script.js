/* Version: #18 */

// === KONFIGURASJON ===
const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIN_VOLUME_THRESHOLD = 0.02; 
const WHITE_KEY_WIDTH = 40; 
const BLACK_KEY_WIDTH = 24; 
const MIC_STABILITY_THRESHOLD = 5; 

// Scroll config
const SCROLL_SMOOTHING = 0.05; 
const SCROLL_TRIGGER_MARGIN = 150; 

// === GLOBALE VARIABLER ===
let VF = null; // VexFlow snarvei (settes ved init)
let audioContext = null;
let analyser = null;
let mediaStreamSource = null;
let isListening = false;
let rafID = null; 
let buflen = 2048;
let buf = new Float32Array(buflen);
let currentActiveKey = null; 
const activeOscillators = new Map(); 

// Variables for Transcription & Game
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
const vexWrapper = document.getElementById('vexflow-wrapper');
const btnClearSheet = document.getElementById('btn-clear-sheet');

// Game Controls
const mainControls = document.getElementById('main-controls');
const gameControls = document.getElementById('game-controls');

const btnRecord = document.getElementById('btn-record');
const btnPlaySeq = document.getElementById('btn-play-seq');
const btnChallenge = document.getElementById('btn-challenge');
const btnRestartGame = document.getElementById('btn-restart-game');
const btnStopGame = document.getElementById('btn-stop-game');
const learningStatus = document.getElementById('learning-status');

// === INIT ===
window.onload = () => {
    // SJEKKER AT VEXFLOW ER LASTET
    if (typeof Vex === 'undefined') {
        log("FEIL: VexFlow biblioteket ble ikke lastet riktig.");
        return;
    }
    VF = Vex.Flow; // Initialiser VexFlow snarvei her

    generatePiano();
    
    pianoContainerWidth = pianoContainer.clientWidth;
    scrollToMiddleImmediate(); 
    
    requestAnimationFrame(updateScrollLoop);
    
    renderSheetMusic();

    updateButtonStates();
    log("Applikasjon lastet. VexFlow klar.");
};

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

// === AUDIO CONTEXT ===
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
        targetScrollPos = centerPos; 
    }
}

function updateScrollLoop() {
    if (currentActiveKey) {
        const keyLeft = currentActiveKey.offsetLeft;
        const keyWidth = currentActiveKey.classList.contains('black') ? BLACK_KEY_WIDTH : WHITE_KEY_WIDTH;
        const keyCenter = keyLeft + (keyWidth / 2);
        const relativePos = keyCenter - pianoContainer.scrollLeft;

        if (relativePos < SCROLL_TRIGGER_MARGIN) {
            targetScrollPos = keyCenter - (pianoContainerWidth / 2);
        }
        else if (relativePos > (pianoContainerWidth - SCROLL_TRIGGER_MARGIN)) {
            targetScrollPos = keyCenter - (pianoContainerWidth / 2);
        }
    }

    const currentScroll = pianoContainer.scrollLeft;
    const diff = targetScrollPos - currentScroll;

    if (Math.abs(diff) > 1) {
        pianoContainer.scrollLeft = currentScroll + (diff * SCROLL_SMOOTHING);
    }

    requestAnimationFrame(updateScrollLoop);
}

// === VEXFLOW SHEET MUSIC RENDERER ===

function renderSheetMusic() {
    if (!VF) return; // Sikkerhetsnett hvis VexFlow ikke lastet

    vexWrapper.innerHTML = '';

    if (recordedSequence.length === 0) {
        const renderer = new VF.Renderer(vexWrapper, VF.Renderer.Backends.SVG);
        renderer.resize(500, 150);
        const context = renderer.getContext();
        const stave = new VF.Stave(10, 40, 400);
        stave.addClef("treble").setContext(context).draw();
        return;
    }

    const noteWidth = 40; 
    const totalWidth = Math.max(500, recordedSequence.length * noteWidth + 50);
    
    const renderer = new VF.Renderer(vexWrapper, VF.Renderer.Backends.SVG);
    renderer.resize(totalWidth, 150);
    const context = renderer.getContext();

    const stave = new VF.Stave(10, 40, totalWidth - 20);
    stave.addClef("treble");
    stave.setContext(context).draw();

    const notes = recordedSequence.map((noteId, index) => {
        const regex = /([A-G])(#?)(-?\d+)/;
        const match = noteId.match(regex);
        
        let vfKey = "c/4"; 
        let accidental = "";

        if (match) {
            const letter = match[1].toLowerCase();
            const acc = match[2]; 
            const octave = match[3];
            vfKey = `${letter}${acc}/${octave}`;
            accidental = acc;
        }

        const staveNote = new VF.StaveNote({ 
            keys: [vfKey], 
            duration: "q",
            auto_stem: true 
        });

        if (accidental) {
            staveNote.addModifier(0, new VF.Accidental(accidental));
        }

        // Fargelegging
        if (isChallenging) {
            if (index < challengeIndex) {
                // Riktig (Grønn)
                staveNote.setStyle({fillStyle: "#4caf50", strokeStyle: "#4caf50"});
            } else if (index === challengeIndex) {
                // Aktiv (Blå)
                staveNote.setStyle({fillStyle: "#2196f3", strokeStyle: "#2196f3"});
            } else {
                // Fremtid (Svart)
                staveNote.setStyle({fillStyle: "black", strokeStyle: "black"});
            }
        }

        return staveNote;
    });

    const numBeats = notes.length;
    const voice = new VF.Voice({num_beats: numBeats, beat_value: 4});
    voice.addTickables(notes);

    new VF.Formatter().joinVoices([voice]).format([voice], totalWidth - 50);

    voice.draw(context, stave);
    
    const scrollArea = document.getElementById('sheet-music-scroll');
    scrollArea.scrollLeft = scrollArea.scrollWidth;
}


// === GAME LOGIC & INPUT HANDLING ===

function handleInput(noteId, frequency, isClick) {
    if (isClick) {
        playTone(noteId, frequency);
    }

    if (isRecording) {
        recordedSequence.push(noteId);
        log(`Tatt opp: ${noteId}`);
        learningStatus.innerText = `Tar opp... Antall noter: ${recordedSequence.length}`;
        renderSheetMusic(); 
        updateButtonStates();
    } 
    else if (isChallenging) {
        checkPlayerInput(noteId);
    }
}

// === HINT SYSTEM ===
function clearHints() {
    const allKeys = document.querySelectorAll('.key');
    allKeys.forEach(k => k.classList.remove('hint'));
}

function showNextHint() {
    clearHints();
    if (challengeIndex < recordedSequence.length) {
        const nextNoteId = recordedSequence[challengeIndex];
        const keyElement = document.getElementById(`key-${nextNoteId}`);
        if (keyElement) {
            keyElement.classList.add('hint');
        }
    }
}

function checkPlayerInput(noteId) {
    if (challengeIndex >= recordedSequence.length) return; 

    const expectedNote = recordedSequence[challengeIndex];
    const keyElement = document.getElementById(`key-${noteId}`);

    if (noteId === expectedNote) {
        log(`Riktig! (${noteId})`);
        
        if (keyElement) {
            keyElement.classList.add('correct');
            setTimeout(() => keyElement.classList.remove('correct'), 300);
        }

        challengeIndex++;
        
        renderSheetMusic();

        if (challengeIndex >= recordedSequence.length) {
            learningStatus.innerText = "🏆 HURRA! Du klarte det!";
            log("Utfordring fullført!");
            clearHints();
        } else {
            learningStatus.innerText = `Riktig! Neste: ${challengeIndex + 1} / ${recordedSequence.length}`;
            showNextHint();
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

// --- Main Menu ---
btnRecord.addEventListener('click', () => {
    if (isRecording) {
        isRecording = false;
        learningStatus.innerText = `Opptak ferdig. ${recordedSequence.length} noter lagret.`;
        log("Stoppet opptak.");
    } else {
        recordedSequence = []; 
        isRecording = true;
        isChallenging = false; 
        renderSheetMusic(); 
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
    clearHints();

    for (let i = 0; i < recordedSequence.length; i++) {
        const noteId = recordedSequence[i];
        await playDemoNote(noteId);
        await new Promise(r => setTimeout(r, 100)); 
    }

    isPlayingSequence = false;
    learningStatus.innerText = "Ferdig spilt. Din tur?";
    updateButtonStates();
});

btnChallenge.addEventListener('click', () => {
    startChallengeMode();
});

btnRestartGame.addEventListener('click', () => {
    log("Starter øvelse på nytt...");
    challengeIndex = 0;
    renderSheetMusic();
    showNextHint(); 
    learningStatus.innerText = "Startet på nytt. Spill den blå tangenten!";
});

btnStopGame.addEventListener('click', () => {
    stopChallengeMode();
});

btnClearSheet.addEventListener('click', () => {
    recordedSequence = [];
    renderSheetMusic();
    updateButtonStates();
    log("Noter slettet.");
});


// === MODE SWITCHING HELPERS ===

function startChallengeMode() {
    if (recordedSequence.length === 0) return;
    
    isChallenging = true;
    isRecording = false;
    challengeIndex = 0;
    
    mainControls.style.display = 'none';
    gameControls.style.display = 'flex';
    
    learningStatus.innerText = "🎓 ØVELSE STARTET! Følg de blå hintene.";
    log("Startet øvelse.");
    
    renderSheetMusic(); 
    showNextHint();     
    updateButtonStates();
}

function stopChallengeMode() {
    isChallenging = false;
    challengeIndex = 0;
    clearHints();
    
    mainControls.style.display = 'flex';
    gameControls.style.display = 'none';
    
    learningStatus.innerText = "Øvelse avsluttet.";
    log("Avsluttet øvelse.");
    
    renderSheetMusic(); 
    updateButtonStates();
}

function updateButtonStates() {
    btnRecord.innerText = isRecording ? "⏹ Stopp Opptak" : "⏺ Start Opptak";
    btnRecord.classList.toggle('active', isRecording);

    btnRecord.disabled = isPlayingSequence || isChallenging;
    btnPlaySeq.disabled = isRecording || isPlayingSequence || isChallenging || recordedSequence.length === 0;
    btnChallenge.disabled = isRecording || isPlayingSequence || isChallenging || recordedSequence.length === 0;
    btnClearSheet.disabled = isRecording || isChallenging;
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

        currentActiveKey = key; 

        setTimeout(() => {
            gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
            osc.stop(ctx.currentTime + 0.1);
            if (key) key.classList.remove('active');
            resolve();
        }, 500); 
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
        currentActiveKey = null; 
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
            currentActiveKey.classList.remove('active');
            currentActiveKey = null;
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

        const keyElement = document.getElementById(`key-${noteId}`);
        if (keyElement) {
            if (currentActiveKey && currentActiveKey !== keyElement) {
                currentActiveKey.classList.remove('active');
            }
            keyElement.classList.add('active');
            currentActiveKey = keyElement;
        }

        if (micStableFrames > MIC_STABILITY_THRESHOLD) {
             if (noteId !== lastRegisteredNote) {
                 handleInput(noteId, ac, false); 
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

/* Version: #18 */
