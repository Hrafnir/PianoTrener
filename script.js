/* Version: #38 */

// === KONFIGURASJON ===
const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIN_VOLUME_THRESHOLD = 0.02; 
const WHITE_KEY_WIDTH = 40; 
const BLACK_KEY_WIDTH = 24; 
const MIC_STABILITY_THRESHOLD = 5; 

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

// MUSIC DATA
let recordedSequence = []; 
let currentDuration = "q"; 
let isDotted = false;
let bpm = 100;
let timeSignature = "4/4"; 
let metronomeEnabled = false;

// INTERACTION STATE
let selectedNoteIndex = -1;

// GAME STATE
let isRecording = false;
let isChallenging = false;
let challengeIndex = 0;
let isPlayingSequence = false; 

// Mic
let micPendingNote = null;
let micStableFrames = 0;
let lastRegisteredNote = null; 

// VIEW ZONES
let currentZone = 2; 

// === MIDI & VISUALIZER VARIABLER ===
let midiData = null;
let polySynth = null;
let isMidiPlaying = false;
let animationId = null;
const canvas = document.getElementById('falling-notes-canvas');
const ctx = canvas.getContext('2d');
const noteSpeed = 150; // Pixels per sekund
let keyPositions = {}; // Mapper MIDI-nummer til X-posisjon

// === DOM ELEMENTER ===
const btnStartMic = document.getElementById('btn-start-mic');
const displayStatus = document.getElementById('status-display');
const displayNote = document.getElementById('note-display');
const logContainer = document.getElementById('app-log');
const pianoContainer = document.getElementById('piano-container');
const pianoInner = document.getElementById('piano');

const vexWrapper = document.getElementById('vexflow-wrapper');
const btnClearSheet = document.getElementById('btn-clear-sheet');
const btnDownload = document.getElementById('btn-download');

// Settings
const bpmInput = document.getElementById('bpm-input');
const timeSigInput = document.getElementById('time-sig-input');
const btnToggleMetronome = document.getElementById('btn-toggle-metronome');
const btnAddRest = document.getElementById('btn-add-rest');
const btnToggleDot = document.getElementById('btn-toggle-dot');
const btnUndo = document.getElementById('btn-undo');
const contextMenu = document.getElementById('note-context-menu');

const mainControls = document.getElementById('main-controls');
const gameControls = document.getElementById('game-controls');
const learningStatus = document.getElementById('learning-status');

const btnRecord = document.getElementById('btn-record');
const btnPlaySeq = document.getElementById('btn-play-seq');
const btnChallenge = document.getElementById('btn-challenge');
const btnRestartGame = document.getElementById('btn-restart-game');
const btnStopGame = document.getElementById('btn-stop-game');

// MIDI Controls
const midiUpload = document.getElementById('midi-upload');
const btnStartMidi = document.getElementById('btn-start-midi');
const btnPauseMidi = document.getElementById('btn-pause-midi');
const btnStopMidi = document.getElementById('btn-stop-midi');
const midiInfo = document.getElementById('midi-info');

// === INIT ===
window.onload = () => {
    log("Systemet starter...");
    if (typeof Vex === 'undefined') {
        log("FEIL: VexFlow ble ikke lastet.");
        return;
    }
    VF = Vex.Flow; 
    generatePiano();
    
    // Synkroniser canvas-størrelse med pianoet
    updateCanvasSize();

    setTimeout(() => jumpToZone(2), 100);

    renderSheetMusic();
    updateButtonStates();
    
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target) && !e.target.closest('.vf-stavenote')) {
            closeContextMenu();
        }
    });

    // MIDI Listeners
    midiUpload.addEventListener('change', handleMidiUpload);
    btnStartMidi.addEventListener('click', startMidiPlayback);
    btnPauseMidi.addEventListener('click', pauseMidiPlayback);
    btnStopMidi.addEventListener('click', stopMidiPlayback);
    
    log("Klar. Bruk Piltaster for å bytte soner.");
};

window.onresize = () => {
    renderSheetMusic(); 
    updateCanvasSize();
};

// === MIDI LOGIKK ===

async function handleMidiUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    log(`Laster MIDI: ${file.name}`);
    midiInfo.innerText = `Laster ${file.name}...`;

    const reader = new FileReader();
    reader.onload = async (event) => {
        const midi = new Midi(event.target.result);
        midiData = midi;
        log(`MIDI Lastet. Spor: ${midi.tracks.length}, Tempo: ${midi.header.tempos[0]?.bpm || 'Ukjent'}`);
        midiInfo.innerText = `Klar: ${file.name}`;
        btnStartMidi.disabled = false;
        btnStopMidi.disabled = false;
        
        // Klargjør Tone.js
        await Tone.start();
        if (!polySynth) {
            polySynth = new Tone.PolySynth(Tone.Synth).toDestination();
        }
    };
    reader.readAsArrayBuffer(file);
}

function startMidiPlayback() {
    if (!midiData) return;
    
    // Hvis vi var stoppet helt, planlegg noter
    if (Tone.Transport.state !== "started") {
        Tone.Transport.cancel();
        
        midiData.tracks.forEach(track => {
            track.notes.forEach(note => {
                Tone.Transport.schedule((time) => {
                    polySynth.triggerAttackRelease(note.name, note.duration, time, note.velocity);
                    
                    // Visuell feedback på piano
                    Tone.Draw.schedule(() => {
                        const key = document.getElementById(`key-${note.name}`);
                        if (key) {
                            key.classList.add('active');
                            setTimeout(() => key.classList.remove('active'), note.duration * 1000);
                        }
                    }, time);

                }, note.time);
            });
        });
    }

    Tone.Transport.start();
    isMidiPlaying = true;
    btnStartMidi.disabled = true;
    btnPauseMidi.disabled = false;
    
    log("Starter avspilling...");
    renderFallingNotes();
}

function pauseMidiPlayback() {
    Tone.Transport.pause();
    isMidiPlaying = false;
    btnStartMidi.disabled = false;
    btnPauseMidi.disabled = true;
    log("Pause.");
}

function stopMidiPlayback() {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    isMidiPlaying = false;
    btnStartMidi.disabled = false;
    btnPauseMidi.disabled = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    log("Stoppet MIDI.");
}

function renderFallingNotes() {
    if (!isMidiPlaying) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const currentTime = Tone.Transport.seconds;
    const viewWindow = canvas.height / noteSpeed; // Hvor mange sekunder vi ser på skjermen

    midiData.tracks.forEach(track => {
        track.notes.forEach(note => {
            // Tegn bare noter som er i ferd med å falle eller som er aktive
            if (note.time + note.duration > currentTime && note.time < currentTime + viewWindow) {
                
                const pos = keyPositions[note.name];
                if (!pos) return;

                const x = pos.x;
                const width = pos.w;
                
                // Kalkuler Y basert på tid til treff
                // Bunnen av canvas (canvas.height) er "NÅ"
                const yStart = canvas.height - ((note.time - currentTime) * noteSpeed) - (note.duration * noteSpeed);
                const height = note.duration * noteSpeed;

                // Farge basert på om noten er hvit eller svart
                ctx.fillStyle = note.name.includes('#') ? '#9c27b0' : '#2196f3';
                ctx.shadowBlur = 10;
                ctx.shadowColor = ctx.fillStyle;
                
                // Tegn avrundet rektangel (stav)
                drawRoundedRect(ctx, x + 2, yStart, width - 4, height, 5);
                ctx.shadowBlur = 0;
            }
        });
    });

    animationId = requestAnimationFrame(renderFallingNotes);
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
}

// === PIANO & COORDINATE MAPPING ===

function updateCanvasSize() {
    // Canvas må være like bred som piano-elementet for at notene skal treffe riktig
    canvas.width = pianoInner.scrollWidth;
    canvas.height = 300;
    
    // Map alle tangenters posisjoner
    keyPositions = {};
    const keys = pianoInner.querySelectorAll('.key');
    keys.forEach(k => {
        keyPositions[k.dataset.note] = {
            x: k.offsetLeft,
            w: k.offsetWidth
        };
    });
    
    // Sørg for at canvas scroller sammen med pianoet
    pianoContainer.onscroll = () => {
        canvas.style.transform = `translateX(-${pianoContainer.scrollLeft}px)`;
    };
}

function generatePiano() {
    pianoInner.innerHTML = ''; let whiteKeyCount = 0;
    for (let i = 21; i <= 108; i++) {
        const noteName = NOTE_STRINGS[i % 12]; const octave = Math.floor(i / 12) - 1; const noteId = noteName + octave; 
        const frequency = 440 * Math.pow(2, (i - 69) / 12); const isBlack = noteName.includes('#');
        const key = document.createElement('div'); key.id = `key-${noteId}`; key.dataset.note = noteId;
        if (isBlack) { key.className = 'key black'; key.style.left = `${(whiteKeyCount * WHITE_KEY_WIDTH) - (BLACK_KEY_WIDTH / 2)}px`; } 
        else { key.className = 'key white'; whiteKeyCount++; }
        
        const start = (e) => { e.preventDefault(); handleInput(noteId, frequency, true); };
        const end = () => stopTone(noteId);
        
        key.addEventListener('mousedown', start); key.addEventListener('mouseup', end); key.addEventListener('mouseleave', end);
        key.addEventListener('touchstart', (e) => { e.preventDefault(); handleInput(noteId, frequency, true); }, { passive: false }); 
        key.addEventListener('touchend', end);
        pianoInner.appendChild(key);
    }
    updateCanvasSize();
}

// === ZONE NAVIGATION ===
function jumpToZone(zoneNum) {
    let targetMidi = 21; 
    if (zoneNum === 2) targetMidi = 42; 
    else if (zoneNum === 3) targetMidi = 65; 

    const noteName = NOTE_STRINGS[targetMidi % 12];
    const octave = Math.floor(targetMidi / 12) - 1;
    const noteId = noteName + octave;
    const targetKey = document.getElementById(`key-${noteId}`);
    
    if (targetKey) {
        pianoContainer.scrollTo({ left: targetKey.offsetLeft, behavior: 'smooth' });
        currentZone = zoneNum;
        log(`Viser Sone ${currentZone}`);
    }
}

// === INPUT HANDLING (KEYBOARD & UI) ===
window.addEventListener('keydown', (e) => {
    if(e.target.tagName === 'INPUT') return; 
    if (e.key === 'ArrowLeft') {
        e.preventDefault(); if (currentZone > 1) jumpToZone(currentZone - 1);
    } else if (e.key === 'ArrowRight') {
        e.preventDefault(); if (currentZone < 3) jumpToZone(currentZone + 1);
    }

    switch(e.key.toLowerCase()) {
        case '1': setDuration('w', 'dur-1'); break;
        case '2': setDuration('h', 'dur-2'); break;
        case '4': setDuration('q', 'dur-4'); break;
        case '8': setDuration('8', 'dur-8'); break;
        case '9': setDuration('16', 'dur-9'); break;
        case 'p': addRest(); break;
        case '.': toggleDot(); break;
        case 'z': undoLastNote(); break;
    }
});

function setDuration(dur, elementId) {
    currentDuration = dur;
    document.querySelectorAll('.duration-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(elementId).classList.add('active');
    if(isDotted) btnToggleDot.classList.add('active');
}

// Event Listeners for Duration Buttons
document.getElementById('dur-1').onclick = () => setDuration('w', 'dur-1');
document.getElementById('dur-2').onclick = () => setDuration('h', 'dur-2');
document.getElementById('dur-4').onclick = () => setDuration('q', 'dur-4');
document.getElementById('dur-8').onclick = () => setDuration('8', 'dur-8');
document.getElementById('dur-9').onclick = () => setDuration('16', 'dur-9');

btnToggleDot.addEventListener('click', toggleDot);
function toggleDot() {
    isDotted = !isDotted;
    btnToggleDot.classList.toggle('active', isDotted);
    log(`Punktering: ${isDotted ? "PÅ" : "AV"}`);
}

btnUndo.addEventListener('click', undoLastNote);
function undoLastNote() {
    if (recordedSequence.length > 0) {
        recordedSequence.pop();
        log("Angret siste note.");
        renderSheetMusic();
        updateButtonStates();
    }
}

btnAddRest.addEventListener('click', addRest);
function addRest() {
    if (!isRecording) { log("Start opptak for å legge til pauser."); return; }
    recordedSequence.push({ note: "b/4", duration: currentDuration, type: "r", dotted: isDotted });
    renderSheetMusic();
}

// === VEXFLOW RENDERER ===
function renderSheetMusic() {
    if (!VF) return; 
    while (vexWrapper.firstChild) vexWrapper.removeChild(vexWrapper.firstChild);
    
    const availableWidth = vexWrapper.clientWidth - 20; 
    const renderer = new VF.Renderer(vexWrapper, VF.Renderer.Backends.SVG);
    renderer.resize(availableWidth, 500); 
    const context = renderer.getContext();

    const tsParts = timeSignature.split('/');
    const beatsPerMeasure = parseInt(tsParts[0]);
    const beatUnit = parseInt(tsParts[1]); 

    const allNotes = recordedSequence.map((item, index) => {
        let vfKey = "b/4"; let accidental = "";
        if (item.type !== 'r') {
            const regex = /([A-G])(#?)(-?\d+)/;
            const match = item.note.match(regex);
            if (match) { vfKey = `${match[1].toLowerCase()}${match[2]}/${match[3]}`; accidental = match[2]; }
        }
        const noteStruct = { keys: [vfKey], duration: item.duration + (item.type === 'r' ? "r" : ""), auto_stem: true };
        if (item.dotted) noteStruct.dots = 1;
        const staveNote = new VF.StaveNote(noteStruct);
        if (accidental) staveNote.addModifier(0, new VF.Accidental(accidental));
        if (item.dotted) staveNote.addDot(0);
        
        let val = 1;
        switch(item.duration) { case 'w': val = 4; break; case 'h': val = 2; break; case 'q': val = 1; break; case '8': val = 0.5; break; case '16': val = 0.25; break; }
        if (item.dotted) val *= 1.5;
        return { note: staveNote, beats: val };
    });

    let measures = []; let currentMeasure = []; let currentBeats = 0;
    allNotes.forEach((obj) => {
        if (currentBeats + obj.beats > beatsPerMeasure + 0.01) { measures.push(currentMeasure); currentMeasure = []; currentBeats = 0; }
        currentMeasure.push(obj.note); currentBeats += obj.beats;
    });
    if (currentMeasure.length > 0) measures.push(currentMeasure);

    const measureWidth = 250; const measuresPerLine = Math.floor(availableWidth / measureWidth);
    measures.forEach((notesInMeasure, measureIndex) => {
        let x = 10 + ((measureIndex % measuresPerLine) * measureWidth);
        let y = 20 + (Math.floor(measureIndex / measuresPerLine) * 120);
        let stave = new VF.Stave(x, y, measureWidth);
        if (measureIndex % measuresPerLine === 0) stave.addClef("treble");
        stave.setContext(context).draw();
        const voice = new VF.Voice({num_beats: beatsPerMeasure, beat_value: beatUnit}).setStrict(false).addTickables(notesInMeasure);
        new VF.Formatter().joinVoices([voice]).format([voice], measureWidth - 50);
        voice.draw(context, stave);
    });

    const renderedNotes = vexWrapper.querySelectorAll('.vf-stavenote');
    renderedNotes.forEach((el, index) => el.addEventListener('click', (e) => { e.stopPropagation(); openContextMenu(index, e); }));
}

// === CONTEXT MENU ===
function openContextMenu(index, event) {
    selectedNoteIndex = index;
    contextMenu.style.left = `${event.pageX}px`;
    contextMenu.style.top = `${event.pageY}px`;
    contextMenu.style.display = 'block';
}
function closeContextMenu() { contextMenu.style.display = 'none'; selectedNoteIndex = -1; }
window.modifySelectedNote = function(action, value) {
    if (selectedNoteIndex === -1) return;
    const note = recordedSequence[selectedNoteIndex];
    if (action === 'duration') note.duration = value;
    else if (action === 'dot') note.dotted = !note.dotted;
    else if (action === 'type') { note.type = (note.type === 'n') ? 'r' : 'n'; if (note.type === 'r') note.note = "b/4"; }
    else if (action === 'delete') recordedSequence.splice(selectedNoteIndex, 1);
    renderSheetMusic(); closeContextMenu();
};

// === AUDIO & INPUT HANDLING ===
function handleInput(noteId, freq, isClick) {
    if (isClick) playTone(noteId, freq); 
    if (isRecording) {
        recordedSequence.push({ note: noteId, duration: currentDuration, type: 'n', dotted: isDotted });
        renderSheetMusic(); updateButtonStates();
    } else if (isChallenging) {
        checkPlayerInput(noteId);
    }
}

function checkPlayerInput(noteId) {
    const target = recordedSequence[challengeIndex];
    if (!target) return;
    if (noteId === target.note) {
        challengeIndex++;
        if (challengeIndex >= recordedSequence.length) learningStatus.innerText = "🏆 Ferdig!";
        else showNextHint();
    }
}

function ensureAudioContext() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    return audioContext;
}

function playTone(noteId, freq) {
    if(activeOscillators.has(noteId)) return;
    const ctx = ensureAudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'triangle'; osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime); gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime+0.05);
    osc.connect(gain); gain.connect(ctx.destination); osc.start(); activeOscillators.set(noteId, {osc, gain});
    const k = document.getElementById(`key-${noteId}`); if(k) k.classList.add('active');
}

function stopTone(noteId) {
    if(!activeOscillators.has(noteId)) return;
    const {osc, gain} = activeOscillators.get(noteId);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime+0.1); osc.stop(audioContext.currentTime+0.1);
    activeOscillators.delete(noteId);
    const k = document.getElementById(`key-${noteId}`); if(k) k.classList.remove('active');
}

// === MISC CONTROLS ===
btnRecord.addEventListener('click', () => { 
    isRecording = !isRecording; 
    if(isRecording) { recordedSequence=[]; learningStatus.innerText="🔴 Tar opp..."; } 
    else learningStatus.innerText="Opptak ferdig."; 
    updateButtonStates(); 
});

btnPlaySeq.addEventListener('click', async () => {
    const msPerBeat = 60000 / bpm;
    for (let item of recordedSequence) {
        let noteBeats = 1; 
        switch(item.duration) { case 'w': noteBeats = 4; break; case 'h': noteBeats = 2; break; case 'q': noteBeats = 1; break; case '8': noteBeats = 0.5; break; case '16': noteBeats = 0.25; break; }
        if (item.dotted) noteBeats *= 1.5;
        if (item.type !== 'r') playDemoTone(item.note, noteBeats * msPerBeat);
        await new Promise(r => setTimeout(r, noteBeats * msPerBeat));
    }
});

function playDemoTone(noteId, dur) {
    const regex = /([A-G]#?)(-?\d+)/; const match = noteId.match(regex);
    const f = 440 * Math.pow(2, (((parseInt(match[2]) + 1) * 12 + NOTE_STRINGS.indexOf(match[1])) - 69) / 12);
    const ctx = ensureAudioContext(); const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.frequency.value = f; g.gain.setValueAtTime(0.3, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + dur/1000);
    osc.connect(g); g.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + dur/1000);
}

function updateButtonStates() {
    btnRecord.innerText = isRecording ? "⏹ Stopp" : "⏺ Opptak";
    btnPlaySeq.disabled = !recordedSequence.length || isRecording;
    btnChallenge.disabled = !recordedSequence.length || isRecording;
}

function log(message) {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

// Pitch Detect Logic (Legacy)
btnStartMic.addEventListener('click', () => { if(isListening) isListening=false; else startPitchDetect(); });
function startPitchDetect() { 
    ensureAudioContext(); 
    navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{
        isListening=true; mediaStreamSource=audioContext.createMediaStreamSource(s);
        analyser=audioContext.createAnalyser(); analyser.fftSize=2048; mediaStreamSource.connect(analyser); updatePitch();
    });
}
function updatePitch() {
    if(!isListening) return;
    analyser.getFloatTimeDomainData(buf);
    const ac = autoCorrelate(buf, audioContext.sampleRate);
    if(ac !== -1) {
        const n = Math.round(12*(Math.log(ac/440)/Math.log(2)))+69;
        const id = NOTE_STRINGS[n%12] + (Math.floor(n/12)-1);
        displayNote.innerText = id;
        handleInput(id, ac, false);
    }
    requestAnimationFrame(updatePitch);
}
function autoCorrelate(buf, sr) {
    let rms=0; for(let i=0;i<buf.length;i++) rms+=buf[i]*buf[i];
    if(Math.sqrt(rms/buf.length)<MIN_VOLUME_THRESHOLD) return -1;
    let r1=0, r2=buf.length-1, t=0.2;
    while(Math.abs(buf[r1])<t && r1<buf.length/2) r1++;
    while(Math.abs(buf[r2])<t && r2>buf.length/2) r2--;
    buf=buf.slice(r1,r2); const c=new Array(buf.length).fill(0);
    for(let i=0;i<buf.length;i++) for(let j=0;j<buf.length-i;j++) c[i]+=buf[j]*buf[j+i];
    let d=0; while(c[d]>c[d+1]) d++;
    let maxv=-1, maxp=-1; for(let i=d;i<buf.length;i++) if(c[i]>maxv) { maxv=c[i]; maxp=i; }
    return sr/maxp;
}

/* Version: #38 */
