/* Version: #23 */

// === KONFIGURASJON ===
const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIN_VOLUME_THRESHOLD = 0.02; 
const WHITE_KEY_WIDTH = 40; 
const BLACK_KEY_WIDTH = 24; 
const MIC_STABILITY_THRESHOLD = 5; 
const SCROLL_SMOOTHING = 0.05; 
const SCROLL_TRIGGER_MARGIN = 150; 

// === GLOBALE VARIABLER ===
let VF = null; 
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
// Format: { note: "C4", duration: "q" }
let recordedSequence = []; 
let currentDuration = "q"; // Default: Quarter note (4)

let isRecording = false;
let isChallenging = false;
let challengeIndex = 0;
let isPlayingSequence = false; 

// Variables for Mic Stability
let micPendingNote = null;
let micStableFrames = 0;
let lastRegisteredNote = null; 

// Smart Scroll
let targetScrollPos = 0;
let pianoContainerWidth = 0;

// === DOM ELEMENTER ===
const btnStartMic = document.getElementById('btn-start-mic');
const displayStatus = document.getElementById('status-display');
const displayNote = document.getElementById('note-display');
const logContainer = document.getElementById('app-log');
const pianoContainer = document.getElementById('piano-container');
const pianoInner = document.getElementById('piano');

const vexWrapper = document.getElementById('vexflow-wrapper');
const sheetScroll = document.getElementById('sheet-music-scroll');
const btnClearSheet = document.getElementById('btn-clear-sheet');
const btnDownload = document.getElementById('btn-download');

const mainControls = document.getElementById('main-controls');
const gameControls = document.getElementById('game-controls');
const learningStatus = document.getElementById('learning-status');

const btnRecord = document.getElementById('btn-record');
const btnPlaySeq = document.getElementById('btn-play-seq');
const btnChallenge = document.getElementById('btn-challenge');
const btnRestartGame = document.getElementById('btn-restart-game');
const btnStopGame = document.getElementById('btn-stop-game');

// === INIT ===
window.onload = () => {
    if (typeof Vex === 'undefined') {
        log("FEIL: VexFlow ble ikke lastet.");
        return;
    }
    VF = Vex.Flow; 

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
    renderSheetMusic(); 
};

// === KEYBOARD LISTENER FOR DURATION ===
window.addEventListener('keydown', (e) => {
    // Ignorer hvis vi skriver i input felt (hvis vi hadde det)
    let newDur = null;
    let uiId = null;

    switch(e.key) {
        case '1': newDur = 'w'; uiId = 'dur-1'; break;
        case '2': newDur = 'h'; uiId = 'dur-2'; break;
        case '4': newDur = 'q'; uiId = 'dur-4'; break;
        case '8': newDur = '8'; uiId = 'dur-8'; break;
        case '9': newDur = '16'; uiId = 'dur-9'; break; // Bruker 9 for 1/16
    }

    if (newDur) {
        setDuration(newDur, uiId);
    }
});

function setDuration(dur, elementId) {
    currentDuration = dur;
    
    // Oppdater UI
    document.querySelectorAll('.duration-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(elementId).classList.add('active');
    
    log(`Satte tonelengde til: ${dur}`);
}

// Støtte for klikk på knappene også
document.getElementById('dur-1').onclick = () => setDuration('w', 'dur-1');
document.getElementById('dur-2').onclick = () => setDuration('h', 'dur-2');
document.getElementById('dur-4').onclick = () => setDuration('q', 'dur-4');
document.getElementById('dur-8').onclick = () => setDuration('8', 'dur-8');
document.getElementById('dur-9').onclick = () => setDuration('16', 'dur-9');


// === LOGGING ===
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

        key.addEventListener('mousedown', (e) => { e.preventDefault(); handleInput(noteId, frequency, true); });
        key.addEventListener('mouseup', () => stopTone(noteId));
        key.addEventListener('mouseleave', () => stopTone(noteId));
        key.addEventListener('touchstart', (e) => { e.preventDefault(); handleInput(noteId, frequency, true); });
        key.addEventListener('touchend', () => stopTone(noteId));

        pianoInner.appendChild(key);
    }
}

// === SMART SCROLL ===
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
        } else if (relativePos > (pianoContainerWidth - SCROLL_TRIGGER_MARGIN)) {
            targetScrollPos = keyCenter - (pianoContainerWidth / 2);
        }
    }
    const diff = targetScrollPos - pianoContainer.scrollLeft;
    if (Math.abs(diff) > 1) {
        pianoContainer.scrollLeft = pianoContainer.scrollLeft + (diff * SCROLL_SMOOTHING);
    }
    requestAnimationFrame(updateScrollLoop);
}

// === VEXFLOW RENDERER ===
function renderSheetMusic() {
    if (!VF) return; 
    vexWrapper.innerHTML = '';
    
    const containerWidth = sheetScroll.clientWidth; 
    const noteWidth = 50; // Litt bredere for å gi plass til flagg/hjerter
    const requiredWidth = recordedSequence.length * noteWidth + 50;
    const totalWidth = Math.max(containerWidth - 20, requiredWidth);
    const height = 220; 
    const staveY = 60;  

    const renderer = new VF.Renderer(vexWrapper, VF.Renderer.Backends.SVG);
    renderer.resize(totalWidth, height);
    const context = renderer.getContext();

    if (recordedSequence.length === 0) {
        const stave = new VF.Stave(10, staveY, totalWidth - 20);
        stave.addClef("treble").setContext(context).draw();
        return;
    }

    const stave = new VF.Stave(10, staveY, totalWidth - 20);
    stave.addClef("treble");
    stave.setContext(context).draw();

    // Map notene til VexFlow StaveNotes
    const notes = recordedSequence.map((item, index) => {
        // item = { note: "C#4", duration: "q" }
        
        const regex = /([A-G])(#?)(-?\d+)/;
        const match = item.note.match(regex);
        
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
            duration: item.duration, 
            auto_stem: true 
        });

        if (accidental) {
            staveNote.addModifier(0, new VF.Accidental(accidental));
        }

        // Fargelegging
        if (isChallenging) {
            if (index < challengeIndex) {
                staveNote.setStyle({fillStyle: "#4caf50", strokeStyle: "#4caf50"});
            } else if (index === challengeIndex) {
                staveNote.setStyle({fillStyle: "#2196f3", strokeStyle: "#2196f3"});
            } else {
                staveNote.setStyle({fillStyle: "black", strokeStyle: "black"});
            }
        }

        return staveNote;
    });

    // Beregn totalt antall beats for Voice
    // VexFlow trenger dette for spacing.
    // q=1, h=2, w=4, 8=0.5, 16=0.25
    // Vi jukser litt og lager en voice som er lang nok.
    // Vi setter beat_value til 4 (quarter note base)
    
    let totalBeats = 0;
    recordedSequence.forEach(item => {
        switch(item.duration) {
            case 'w': totalBeats += 4; break;
            case 'h': totalBeats += 2; break;
            case 'q': totalBeats += 1; break;
            case '8': totalBeats += 0.5; break;
            case '16': totalBeats += 0.25; break;
            default: totalBeats += 1;
        }
    });

    // Avrund oppover for sikkerhets skyld, eller bruk en stor voice
    // VexFlow kan være sær på eksakt beat count hvis man bruker streng tid.
    // Men med formatter.format([voice], width) går det ofte greit.
    // Vi setter num_beats til totalBeats. 
    // OBS: Voice støtter ikke desimal beats direkte alltid i gamle versjoner, men la oss prøve.
    // Hvis det feiler, setter vi num_beats til note.length * 4 (worst case).
    
    // Sikrere metode for "fri flyt":
    // Vi bruker beat_value = 1/16 (dvs 16), og teller antall 16-deler.
    // w=16, h=8, q=4, 8=2, 16=1
    let sixteenths = 0;
    recordedSequence.forEach(item => {
        switch(item.duration) {
            case 'w': sixteenths += 16; break;
            case 'h': sixteenths += 8; break;
            case 'q': sixteenths += 4; break;
            case '8': sixteenths += 2; break;
            case '16': sixteenths += 1; break;
        }
    });

    const voice = new VF.Voice({num_beats: sixteenths, beat_value: 16});
    voice.setStrict(false); // Tillat litt fleksibilitet
    voice.addTickables(notes);

    new VF.Formatter().joinVoices([voice]).format([voice], totalWidth - 50);

    voice.draw(context, stave);
    
    if (requiredWidth > containerWidth) {
        sheetScroll.scrollLeft = sheetScroll.scrollWidth;
    }
}

// === EXPORT FUNCTION ===
btnDownload.addEventListener('click', () => {
    if (recordedSequence.length === 0) {
        alert("Ingen noter å lagre!");
        return;
    }

    // Hent SVG innhold
    const svgData = vexWrapper.innerHTML;
    
    // Legg til XML namespace hvis det mangler (VexFlow legger det ofte til, men for sikkerhets skyld)
    const prefixedSvg = svgData.replace(/<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ');

    // Lag Blob
    const blob = new Blob([prefixedSvg], {type: "image/svg+xml;charset=utf-8"});
    const url = URL.createObjectURL(blob);

    // Lag midlertidig lenke og klikk
    const downloadLink = document.createElement("a");
    downloadLink.href = url;
    downloadLink.download = "mine_noter.svg";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    
    log("Lastet ned noteark (SVG).");
});

// === INPUT & GAME LOGIC ===

function handleInput(noteId, frequency, isClick) {
    if (isClick) playTone(noteId, frequency);

    if (isRecording) {
        // NYTT: Lagre objekt med varighet
        const noteObj = { note: noteId, duration: currentDuration };
        recordedSequence.push(noteObj);
        
        log(`Tatt opp: ${noteId} (${currentDuration})`);
        learningStatus.innerText = `Tar opp... Antall noter: ${recordedSequence.length}`;
        renderSheetMusic(); 
        updateButtonStates();
    } 
    else if (isChallenging) {
        checkPlayerInput(noteId);
    }
}

function checkPlayerInput(noteId) {
    if (challengeIndex >= recordedSequence.length) return; 

    // Hent fasit fra objektet
    const expectedNote = recordedSequence[challengeIndex].note;
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

// === HINT SYSTEM ===
function clearHints() {
    document.querySelectorAll('.key').forEach(k => k.classList.remove('hint'));
}
function showNextHint() {
    clearHints();
    if (challengeIndex < recordedSequence.length) {
        const nextNoteId = recordedSequence[challengeIndex].note;
        const keyElement = document.getElementById(`key-${nextNoteId}`);
        if (keyElement) keyElement.classList.add('hint');
    }
}

// === BUTTONS ===
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
        learningStatus.innerText = "🔴 TAR OPP! Velg tonelengde (1-9) og spill.";
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
        const item = recordedSequence[i];
        // Enkel playback. Kunne implementert rytme basert på item.duration her.
        await playDemoNote(item.note);
        await new Promise(r => setTimeout(r, 100)); // Pause
    }
    isPlayingSequence = false;
    learningStatus.innerText = "Ferdig spilt. Din tur?";
    updateButtonStates();
});

btnChallenge.addEventListener('click', startChallengeMode);
btnRestartGame.addEventListener('click', () => {
    challengeIndex = 0;
    renderSheetMusic();
    showNextHint();
    learningStatus.innerText = "Startet på nytt.";
});
btnStopGame.addEventListener('click', stopChallengeMode);

btnClearSheet.addEventListener('click', () => {
    recordedSequence = [];
    renderSheetMusic();
    updateButtonStates();
    log("Noter slettet.");
});

function startChallengeMode() {
    if (recordedSequence.length === 0) return;
    isChallenging = true;
    isRecording = false;
    challengeIndex = 0;
    mainControls.style.display = 'none';
    gameControls.style.display = 'flex';
    learningStatus.innerText = "🎓 ØVELSE STARTET!";
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
    btnDownload.disabled = recordedSequence.length === 0;
}

// === SOUND & MIC ===
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
    gainNode.gain.cancelScheduledValues(ctx.currentTime);
    gainNode.gain.setValueAtTime(gainNode.gain.value, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.stop(ctx.currentTime + 0.1);
    setTimeout(() => { osc.disconnect(); gainNode.disconnect(); }, 150);
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

btnStartMic.addEventListener('click', toggleMicrophone);
function toggleMicrophone() {
    if (isListening) {
        isListening = false;
        btnStartMic.innerText = "Start Mikrofon / Lyd";
        cancelAnimationFrame(rafID);
        displayStatus.innerText = "Status: Pauset";
        micPendingNote = null;
        lastRegisteredNote = null;
        document.querySelectorAll('.key').forEach(k => k.classList.remove('active'));
        currentActiveKey = null; 
    } else {
        startPitchDetect();
    }
}

function startPitchDetect() {
    ensureAudioContext(); 
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, autoGainControl: false, noiseSuppression: false } })
    .then((stream) => {
        isListening = true;
        btnStartMic.innerText = "Stopp Mikrofon";
        displayStatus.innerText = "Status: Lytter...";
        mediaStreamSource = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        mediaStreamSource.connect(analyser);
        updatePitch();
    }).catch((err) => { log("FEIL: Mikrofon " + err); });
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
        
        if (noteId === micPendingNote) micStableFrames++;
        else { micPendingNote = noteId; micStableFrames = 0; }

        const keyElement = document.getElementById(`key-${noteId}`);
        if (keyElement) {
            if (currentActiveKey && currentActiveKey !== keyElement) currentActiveKey.classList.remove('active');
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

function autoCorrelate(buf, sampleRate) {
    let size = buf.length;
    let rms = 0;
    for (let i = 0; i < size; i++) { const val = buf[i]; rms += val * val; }
    rms = Math.sqrt(rms / size);
    if (rms < MIN_VOLUME_THRESHOLD) return -1;
    let r1 = 0, r2 = size - 1, thres = 0.2;
    for (let i = 0; i < size / 2; i++) { if (Math.abs(buf[i]) < thres) { r1 = i; break; } }
    for (let i = 1; i < size / 2; i++) { if (Math.abs(buf[size - i]) < thres) { r2 = size - i; break; } }
    buf = buf.slice(r1, r2);
    size = buf.length;
    const c = new Array(size).fill(0);
    for (let i = 0; i < size; i++) { for (let j = 0; j < size - i; j++) { c[i] = c[i] + buf[j] * buf[j + i]; } }
    let d = 0; while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < size; i++) { if (c[i] > maxval) { maxval = c[i]; maxpos = i; } }
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
/* Version: #23 */
